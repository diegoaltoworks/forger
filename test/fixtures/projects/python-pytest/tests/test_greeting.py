from app.greeting import greeting


def test_greets_by_name():
    assert greeting("Ada") == "Hello, Ada"
