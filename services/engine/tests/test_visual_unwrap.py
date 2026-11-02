from learnquest_engine.visual import unwrap

BLOCK = {"type": "text", "id": "t1", "props": {"md": "hi"}}


def test_flattens_a_nested_block_list() -> None:
    doc = {"v": 1, "blocks": [{"blocks": [BLOCK]}]}
    assert unwrap(doc)["blocks"] == [BLOCK]


def test_leaves_normal_blocks_alone() -> None:
    doc = {"v": 1, "blocks": [BLOCK]}
    assert unwrap(doc) == doc
