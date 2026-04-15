"""Jina HTTP rerank postprocessor (mocked HTTP)."""

from unittest.mock import MagicMock, patch

from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode

from ingestion.jina_rerank import JinaRerankPostprocessor


def test_jina_rerank_postprocessor_orders_by_api_response() -> None:
    nodes = [
        NodeWithScore(node=TextNode(text="a"), score=0.1),
        NodeWithScore(node=TextNode(text="b"), score=0.2),
        NodeWithScore(node=TextNode(text="c"), score=0.3),
    ]
    qb = QueryBundle(query_str="q")

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "results": [
            {"index": 2, "relevance_score": 0.99},
            {"index": 0, "relevance_score": 0.5},
        ]
    }
    mock_client = MagicMock()
    mock_client.post.return_value = mock_resp
    mock_cm = MagicMock()
    mock_cm.__enter__.return_value = mock_client
    mock_cm.__exit__.return_value = None

    with patch("ingestion.jina_rerank.httpx.Client", return_value=mock_cm):
        pp = JinaRerankPostprocessor(api_key="k", model="m", top_n=2)
        out = pp.postprocess_nodes(nodes, query_bundle=qb)

    assert len(out) == 2
    assert out[0].node.get_content() == "c"
    assert out[1].node.get_content() == "a"
    mock_client.post.assert_called_once()
