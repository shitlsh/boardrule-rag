"""Tests for RAG chat prior-message truncation and condense-skip heuristic."""

from api.routers.chat import (
    ChatMessageIn,
    _should_skip_condense_heuristic,
    _truncate_prior_messages,
)


def _um(n: int) -> list[ChatMessageIn]:
    """Build n alternating user/assistant pairs starting with user."""
    out: list[ChatMessageIn] = []
    for i in range(n):
        role = "user" if i % 2 == 0 else "assistant"
        out.append(ChatMessageIn(role=role, content=f"m{i}"))
    return out


def test_truncate_keeps_last_n_turns() -> None:
    msgs = _um(8)  # 4 turns
    got = _truncate_prior_messages(msgs, max_turns=3)
    assert len(got) == 6
    assert got[0].role == "user"
    assert got[0].content == "m2"


def test_truncate_noop_when_short() -> None:
    msgs = _um(4)
    got = _truncate_prior_messages(msgs, max_turns=3)
    assert got == msgs


def test_truncate_drops_leading_assistant_in_tail() -> None:
    """If the kept window starts with a stray assistant, trim to first user."""
    # Seven messages: 6-message tail begins with assistant (incomplete lead-in).
    msgs = _um(7)
    got = _truncate_prior_messages(msgs, max_turns=3)
    assert got[0].role == "user"
    assert len(got) == 5


def test_skip_heuristic_requires_prior() -> None:
    assert not _should_skip_condense_heuristic("这是一句足够长的独立问题不需要指代", [], 15)


def test_skip_heuristic_short_message() -> None:
    prior = [ChatMessageIn(role="user", content="u"), ChatMessageIn(role="assistant", content="a")]
    assert not _should_skip_condense_heuristic("短", prior, 15)


def test_skip_heuristic_long_no_trigger() -> None:
    prior = [ChatMessageIn(role="user", content="u"), ChatMessageIn(role="assistant", content="a")]
    assert _should_skip_condense_heuristic(
        "请详细说明移动阶段玩家可以执行哪些行动以及顺序限制",
        prior,
        15,
    )


def test_skip_heuristic_blocked_by_temporal_cue_刚才() -> None:
    prior = [ChatMessageIn(role="user", content="u"), ChatMessageIn(role="assistant", content="a")]
    assert not _should_skip_condense_heuristic(
        "刚才那条规则里说的费用结算具体怎么算",
        prior,
        15,
    )


def test_skip_heuristic_blocked_by_continue() -> None:
    prior = [ChatMessageIn(role="user", content="u"), ChatMessageIn(role="assistant", content="a")]
    assert not _should_skip_condense_heuristic("继续说上面提到的行动顺序", prior, 15)

