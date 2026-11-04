from learnquest_engine.visual import unwrap

BLOCK = {"type": "text", "id": "t1", "props": {"md": "hi"}}


def test_flattens_a_nested_block_list() -> None:
    doc = {"v": 1, "blocks": [{"blocks": [BLOCK]}]}
    assert unwrap(doc)["blocks"] == [BLOCK]


def test_leaves_normal_blocks_alone() -> None:
    doc = {"v": 1, "blocks": [BLOCK]}
    assert unwrap(doc) == doc


def test_ts_check_reports_a_path_anchor_below_the_canvas() -> None:
    from learnquest_engine.visual import ts_issues

    shape = {"id": "p", "kind": "path", "x": 50, "y": -10, "d": "M 10 10 L 20 20", "stroke": "ink"}
    doc = {
        "v": 1,
        "blocks": [{"type": "stage", "id": "s", "props": {"alt": "A path", "shapes": [shape]}}],
    }
    assert any(i.startswith("blocks.0.props.shapes.0.y:") for i in ts_issues(doc))
