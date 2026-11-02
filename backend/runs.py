"""Background council runs that any number of clients can watch.

A run lives on the server independently of the HTTP request that started it,
so the browser (or the CLI) can connect, disconnect, and reconnect while the
council deliberates. Each watcher replays every event from the start.
"""

import asyncio
from typing import Any, AsyncIterator, Dict, Optional, Set

from . import storage
from .config import CouncilSettings
from .council import (
    build_label_to_model,
    seats_from_plan,
    stage0_plan_council,
    calculate_aggregate_rankings,
    generate_conversation_title,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
)

TERMINAL_EVENTS = {"complete", "error"}


class CouncilRun:
    def __init__(self, conversation_id: str):
        self.conversation_id = conversation_id
        self.events: list[Dict[str, Any]] = []
        self.done = False
        self._changed = asyncio.Condition()

    async def emit(self, event: Dict[str, Any]):
        async with self._changed:
            self.events.append(event)
            if event["type"] in TERMINAL_EVENTS:
                self.done = True
            self._changed.notify_all()

    async def watch(self) -> AsyncIterator[Dict[str, Any]]:
        """Yield every event so far, then new ones until the run finishes."""
        seen = 0
        while True:
            async with self._changed:
                await self._changed.wait_for(lambda: len(self.events) > seen or self.done)
                new = self.events[seen:]
                finished = self.done
            for event in new:
                yield event
            seen += len(new)
            if finished and seen == len(self.events):
                return


_runs: Dict[str, CouncilRun] = {}
_tasks: Set[asyncio.Task] = set()


def get_run(conversation_id: str) -> Optional[CouncilRun]:
    return _runs.get(conversation_id)


def is_active(conversation_id: str) -> bool:
    run = _runs.get(conversation_id)
    return run is not None and not run.done


def start_run(conversation_id: str, content: str, settings: CouncilSettings) -> CouncilRun:
    """Save the user message and start the council in the background."""
    conversation = storage.get_conversation(conversation_id)
    is_first_message = len(conversation["messages"]) == 0
    storage.add_user_message(conversation_id, content)

    run = CouncilRun(conversation_id)
    _runs[conversation_id] = run
    task = asyncio.create_task(_execute(run, content, is_first_message, settings))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return run


async def _execute(run: CouncilRun, content: str, is_first_message: bool, settings: CouncilSettings):
    conversation_id = run.conversation_id
    try:

        # Start title generation in parallel (don't await yet)
        title_task = None
        if is_first_message:
            title_task = asyncio.create_task(generate_conversation_title(content))

        # Stage 0: Decide how many seats to open and who fills them
        await run.emit({
            'type': 'stage0_start',
            'members': [settings.planner.id],
            'settings': settings.describe()
        })
        plan = await stage0_plan_council(content, settings)
        seats = seats_from_plan(plan)
        members = [seat.id for seat in seats]
        await run.emit({'type': 'stage0_complete', 'data': plan})

        # Stage 1: Collect responses
        await run.emit({'type': 'stage1_start', 'members': members})
        stage1_results = await stage1_collect_responses(
            content,
            seats,
            lambda result: run.emit({'type': 'stage1_response', 'data': result}),
            effort=settings.effort
        )
        await run.emit({'type': 'stage1_complete', 'data': stage1_results})
        if not stage1_results:
            raise RuntimeError("All council members failed to respond.")

        # Stage 2: Collect rankings
        label_to_model = build_label_to_model(stage1_results)
        await run.emit({
            'type': 'stage2_start',
            'members': members,
            'metadata': {'plan': plan, 'label_to_model': label_to_model}
        })
        stage2_results, label_to_model = await stage2_collect_rankings(
            content,
            stage1_results,
            seats,
            lambda result: run.emit({'type': 'stage2_ranking', 'data': result}),
            effort=settings.effort
        )
        aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
        metadata = {
            'settings': settings.describe(),
            'plan': plan,
            'label_to_model': label_to_model,
            'aggregate_rankings': aggregate_rankings
        }
        await run.emit({'type': 'stage2_complete', 'data': stage2_results, 'metadata': metadata})

        # Stage 3: Synthesize final answer
        await run.emit({'type': 'stage3_start', 'members': [settings.chairman.id]})
        stage3_result = await stage3_synthesize_final(
            content, stage1_results, stage2_results, settings.chairman, settings.effort
        )
        await run.emit({'type': 'stage3_complete', 'data': stage3_result})

        # Wait for title generation if it was started
        if title_task:
            title = await title_task
            storage.update_conversation_title(conversation_id, title)
            await run.emit({'type': 'title_complete', 'data': {'title': title}})

        # Save complete assistant message
        storage.add_assistant_message(
            conversation_id,
            stage1_results,
            stage2_results,
            stage3_result,
            metadata
        )

        await run.emit({'type': 'complete'})

    except Exception as e:
        await run.emit({'type': 'error', 'message': str(e)})
