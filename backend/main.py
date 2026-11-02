"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json

from . import storage, runs
from .config import BUDGETS, DEFAULT_BUDGET, DEFAULT_SETTINGS, MODEL_CATALOG, MIN_SEATS, SEAT_LIMIT, FRONTEND_DIST, HOST, PORT, settings_for
from .providers import EFFORT_LEVELS
from .council import run_full_council, generate_conversation_title

app = FastAPI(title="LLM Council API")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation, with optional council settings."""
    content: str
    budget: Optional[str] = None            # economy | standard | max; explicit fields override it
    models: Optional[List[str]] = None      # pool the seats are filled from
    chairman: Optional[str] = None          # also does the planning
    seats: Optional[int] = None             # fixed council size
    max_seats: Optional[int] = None         # let the planner choose up to this many
    effort: Optional[str] = None            # reasoning effort: low | medium | high | xhigh | max

    def settings(self):
        try:
            return settings_for(self.budget, self.models, self.chairman, self.seats, self.max_seats, self.effort)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/council")
async def get_council():
    """Selectable models, the default council settings, and the seat limits."""
    return {
        "catalog": MODEL_CATALOG,
        "defaults": DEFAULT_SETTINGS.describe() if DEFAULT_SETTINGS else None,
        "budgets": BUDGETS,
        "default_budget": DEFAULT_BUDGET,
        "efforts": list(EFFORT_LEVELS),
        "limits": {"min": MIN_SEATS, "max": SEAT_LIMIT},
    }


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    settings = request.settings()

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content, settings
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metadata
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


def _sse(run: runs.CouncilRun) -> StreamingResponse:
    async def event_generator():
        async for event in run.watch():
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


def _start_run(conversation_id: str, request: SendMessageRequest) -> runs.CouncilRun:
    if storage.get_conversation(conversation_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if runs.is_active(conversation_id):
        raise HTTPException(status_code=409, detail="The council is already deliberating")
    return runs.start_run(conversation_id, request.content, request.settings())


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each model responds and each stage completes.
    The run continues in the background if the client disconnects.
    """
    return _sse(_start_run(conversation_id, request))


@app.post("/api/conversations/{conversation_id}/runs")
async def start_run(conversation_id: str, request: SendMessageRequest):
    """Start the council in the background without holding the request open."""
    _start_run(conversation_id, request)
    return {"conversation_id": conversation_id}


@app.get("/api/conversations/{conversation_id}/live")
async def watch_run(conversation_id: str):
    """Replay and follow the latest council run for a conversation."""
    run = runs.get_run(conversation_id)
    if run is None:
        raise HTTPException(status_code=404, detail="No council run for this conversation")
    return _sse(run)


@app.get("/{path:path}", include_in_schema=False)
async def frontend(path: str):
    """Serve the built frontend (run `npm run build` in frontend/)."""
    if path.startswith("api/"):
        raise HTTPException(status_code=404)
    file = (FRONTEND_DIST / path).resolve()
    if path and file.is_relative_to(FRONTEND_DIST.resolve()) and file.is_file():
        return FileResponse(file)
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="Frontend not built; run `npm run build` in frontend/")
    return FileResponse(index)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
