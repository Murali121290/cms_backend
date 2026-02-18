try:
    from app.processing.legacy.highlighter.technical_editor import TechnicalEditor
    print("Import successful")
except Exception as e:
    print(f"Import failed: {e}")
    import traceback
    traceback.print_exc()
