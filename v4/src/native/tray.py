"""GTK tray owned by the daemon; stdin EOF ties its lifetime to the parent."""
import json
import os
import signal
import sys
import gi

gi.require_version("Gtk", "3.0")
try:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3 as AppIndicator
except ValueError:
    gi.require_version("AppIndicator3", "0.1")
    from gi.repository import AppIndicator3 as AppIndicator
from gi.repository import Gtk, GLib, Gio


def emit(action):
    print(json.dumps({"action": action}), flush=True)


menu = Gtk.Menu()
for label, action in [("Mở Chrome / kiểm tra", "show"),
                      ("Dừng nhận giọng nói", "stop"),
                      ("Thoát Voice Type", "quit")]:
    item = Gtk.MenuItem(label=label)
    item.connect("activate", lambda item, action=action: emit(action))
    menu.append(item)
menu.show_all()
indicator = None
recording = False
pending = b""
idle_icon, recording_icon = sys.argv[1:3]


def create_indicator(*args):
    global indicator
    if indicator:
        indicator.set_status(AppIndicator.IndicatorStatus.PASSIVE)
        indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        return
    indicator = AppIndicator.Indicator.new(
        "voice-type-" + str(os.getpid()), recording_icon if recording else idle_icon,
        AppIndicator.IndicatorCategory.APPLICATION_STATUS)
    indicator.set_title("Voice Type")
    indicator.set_menu(menu)
    indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)


def parent_input(fd, condition):
    global pending, recording
    if condition != GLib.IO_IN:
        Gtk.main_quit()
        return False
    chunk = os.read(fd, 4096)
    if not chunk:
        Gtk.main_quit()
        return False
    pending += chunk
    while b"\n" in pending:
        line, pending = pending.split(b"\n", 1)
        state = json.loads(line)
        recording = bool(state["recording"])
        indicator.set_icon_full(recording_icon if recording else idle_icon,
                                "Đang thu âm" if recording else "Chưa thu âm")
    return True



GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, parent_input)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: (Gtk.main_quit(), False)[1])
create_indicator()
Gio.bus_watch_name(Gio.BusType.SESSION, "org.kde.StatusNotifierWatcher",
                  Gio.BusNameWatcherFlags.NONE, create_indicator, lambda *args: None)
emit("ready")
Gtk.main()
