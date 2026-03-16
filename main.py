import webview
import os
import signal
import sys

from api import Api

DATA_DIR = os.path.join(os.path.expanduser("~"), ".local", "share", "abrain")
os.makedirs(DATA_DIR, exist_ok=True)

UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui")


def on_closed():
    # Final save is handled by the JS bridge before closing; just exit cleanly.
    pass


def main():
    api = Api(DATA_DIR)

    window = webview.create_window(
        title="ABrain",
        url=os.path.join(UI_DIR, "index.html"),
        js_api=api,
        width=1400,
        height=900,
        min_size=(900, 600),
        background_color="#1e1e2e",
    )

    api.set_window(window)
    window.events.closed += on_closed

    # Use qt gui to integrate naturally with KDE Plasma
    webview.start(gui="qt", debug=False)


if __name__ == "__main__":
    # Allow Ctrl+C in terminal to close cleanly
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    main()
