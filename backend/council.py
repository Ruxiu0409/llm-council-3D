"""LLM Council orchestration: plan the seats, then the 3 deliberation stages."""

import json
import re
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Tuple, Optional, Callable, Awaitable
from .providers import Member, parse_member, query_parallel, query_member
from .config import CouncilSettings, TITLE_MODEL

ResultCallback = Optional[Callable[[Dict[str, Any]], Awaitable[None]]]


@dataclass
class Seat:
    """One council seat: a perspective filled by a model from the pool."""
    id: str        # unique, shown in the UI: "claude/opus · Skeptic"
    model: str     # pool member id, e.g. "claude/opus"
    role: str
    brief: str

    @property
    def member(self) -> Member:
        return parse_member(self.model)


def _seat_id(model: str, role: str, taken: set) -> str:
    base = f"{model} · {role}" if role else model
    seat_id, n = base, 2
    while seat_id in taken:
        seat_id, n = f"{base} {n}", n + 1
    taken.add(seat_id)
    return seat_id


def default_seats(settings: CouncilSettings) -> List[Seat]:
    """Fallback when planning fails: one plain seat per pool model, within the seat limits."""
    pool = settings.pool
    taken: set = set()
    count = min(settings.max_seats, max(settings.min_seats, len(pool)))
    return [
        Seat(id=_seat_id(pool[i % len(pool)].id, "", taken),
             model=pool[i % len(pool)].id, role="", brief="")
        for i in range(count)
    ]


def parse_plan(text: str, settings: CouncilSettings) -> Tuple[str, List[Seat]]:
    """Parse the planner's JSON into seats, clamped to the allowed size and pool."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("planner returned no JSON")
    plan = json.loads(match.group())

    pool_ids = [m.id for m in settings.pool]
    taken: set = set()
    seats = []
    for i, raw in enumerate(plan.get("seats", [])[:settings.max_seats]):
        model = raw.get("model")
        if model not in pool_ids:
            model = pool_ids[i % len(pool_ids)]
        role = str(raw.get("role", "")).strip()
        seats.append(Seat(
            id=_seat_id(model, role, taken),
            model=model,
            role=role,
            brief=str(raw.get("brief", "")).strip(),
        ))
    if len(seats) < settings.min_seats:
        raise ValueError(f"planner opened {len(seats)} seats (minimum {settings.min_seats})")
    return str(plan.get("reason", "")).strip(), seats


async def stage0_plan_council(user_query: str, settings: CouncilSettings) -> Dict[str, Any]:
    """
    Stage 0: The planner decides how many seats to open and who sits in them.

    Args:
        user_query: The user's question
        settings: The model pool, planner, and seat limits for this run

    Returns:
        Dict with 'planner', 'reason', and 'seats' (list of seat dicts)
    """
    pool = ", ".join(m.id for m in settings.pool)
    if settings.min_seats == settings.max_seats:
        sizing = f"Open exactly {settings.max_seats} seats and decide what perspective each seat brings."
        size_rule = "- The user fixed the council size. Choose perspectives so every seat adds an angle the others won't cover."
    else:
        sizing = f"Decide how many seats this question deserves (between {settings.min_seats} and {settings.max_seats}) and what perspective each seat brings."
        size_rule = "- Size the council to the question. A narrow or simple question needs only a few seats; a high-stakes decision with many tradeoffs, stakeholders, or domains deserves more. Every seat must add an angle the others won't cover. Never add seats that would repeat each other."
    planning_prompt = f"""You are convening an LLM Council: several AI seats will answer the question below independently, then anonymously review and rank each other, and a chairman will synthesize a final answer.

{sizing}

Guidelines:
{size_rule}
- Give each seat a distinct, question-specific perspective (a relevant domain expert, an affected stakeholder, a skeptic hunting for failure modes, a first-principles thinker, a pragmatic implementer, ...), chosen so the seats genuinely disagree where it matters.
- Assign each seat a model from this pool: {pool}. Spread seats across different models when possible; one model may hold several seats.
- Write "reason", "role", and "brief" in the same language as the question.

Respond with only a JSON object, no code fences, in exactly this shape:
{{"reason": "one or two sentences on why this size and mix", "seats": [{{"model": "<pool model>", "role": "short perspective name, at most 6 words", "brief": "1-2 sentences on what this seat focuses on"}}]}}

Question:
{user_query}"""

    reason, seats = "", None
    response = await query_member(settings.planner, planning_prompt, effort=settings.effort)
    if response is not None:
        try:
            reason, seats = parse_plan(response, settings)
        except (ValueError, json.JSONDecodeError, AttributeError) as e:
            print(f"Error parsing council plan: {e}", flush=True)
    if seats is None:
        reason, seats = "Planning failed; using one seat per available model.", default_seats(settings)

    return {
        "planner": settings.planner.id,
        "reason": reason,
        "seats": [asdict(seat) for seat in seats],
    }


def seats_from_plan(plan: Dict[str, Any]) -> List[Seat]:
    return [Seat(**seat) for seat in plan["seats"]]


def seat_prompt(seat: Seat, user_query: str) -> str:
    """The Stage 1 prompt for a seat: its perspective, then the question."""
    if not seat.role:
        return user_query
    return f"""You hold a seat on an LLM Council as: {seat.role}
Your angle: {seat.brief}

Answer the question below from this angle. Be direct and specific. Other seats cover other angles, so lean fully into yours instead of trying to be balanced. Answer in the same language as the question.

Question:
{user_query}"""


async def stage1_collect_responses(
    user_query: str,
    seats: List[Seat],
    on_response: ResultCallback = None,
    effort: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from every seat.

    Args:
        user_query: The user's question
        seats: The council seats from Stage 0
        on_response: Optional callback fired as each seat responds

    Returns:
        List of dicts with 'model' (the seat id) and 'response' keys
    """
    async def report(seat_id, text):
        if on_response:
            await on_response({"model": seat_id, "response": text})

    # Query all seats in parallel
    jobs = [(seat.id, seat.member, seat_prompt(seat, user_query)) for seat in seats]
    responses = await query_parallel(jobs, report, effort=effort)

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response
            })

    return stage1_results


def build_label_to_model(stage1_results: List[Dict[str, Any]]) -> Dict[str, str]:
    """Map anonymized labels ("Response A", ...) to the models that wrote them."""
    return {
        f"Response {chr(65 + i)}": result['model']
        for i, result in enumerate(stage1_results)
    }


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    seats: List[Seat],
    on_ranking: ResultCallback = None,
    effort: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each seat ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1
        seats: The council seats from Stage 0
        on_ranking: Optional callback fired as each seat finishes ranking

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = build_label_to_model(stage1_results)

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    def to_ranking(model: str, full_text: str) -> Dict[str, Any]:
        return {
            "model": model,
            "ranking": full_text,
            "parsed_ranking": parse_ranking_from_text(full_text)
        }

    async def report(seat_id, text):
        if on_ranking:
            await on_ranking(to_ranking(seat_id, text))

    # Get rankings from every seat in parallel (reviews are neutral, not in character)
    jobs = [(seat.id, seat.member, ranking_prompt) for seat in seats]
    responses = await query_parallel(jobs, report, effort=effort)

    # Format results
    stage2_results = [
        to_ranking(model, response)
        for model, response in responses.items()
        if response is not None
    ]

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    chairman: Member,
    effort: Optional[str] = None
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2
        chairman: The model that writes the final answer

    Returns:
        Dict with 'model' and 'response' keys
    """
    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Seat: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Seat: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    chairman_prompt = f"""You are the Chairman of an LLM Council. Several council seats, each answering from a different perspective ("model · perspective"), have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement between perspectives

Answer in the same language as the original question. Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    # Query the chairman model
    response = await query_member(chairman, chairman_prompt, effort=effort)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": chairman.id,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": chairman.id,
        "response": response
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    response = await query_member(TITLE_MODEL, title_prompt, timeout=60.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def run_full_council(user_query: str, settings: CouncilSettings) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        settings: The model pool, chairman, and seat limits for this run

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 0: Decide the seats
    plan = await stage0_plan_council(user_query, settings)
    seats = seats_from_plan(plan)

    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, seats, effort=settings.effort)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(
        user_query, stage1_results, seats, effort=settings.effort
    )

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        settings.chairman,
        settings.effort
    )

    # Prepare metadata
    metadata = {
        "plan": plan,
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }

    return stage1_results, stage2_results, stage3_result, metadata
