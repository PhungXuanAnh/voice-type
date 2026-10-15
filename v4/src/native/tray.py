"""GTK tray owned by the daemon; stdin EOF ties its lifetime to the parent.

A legacy XEmbed StatusIcon is used instead of AppIndicator because GNOME's
AppIndicator extension opens the menu on every left click, while legacy tray
icons receive the real mouse button: left click toggles, right click shows the menu.
"""
import json
import os
import signal
import sys
import warnings
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib, GdkPixbuf

warnings.filterwarnings("ignore", category=DeprecationWarning)


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
pending = b""
idle_icon, recording_icon = sys.argv[1:3]

icon_size = 24
icon_path = idle_icon


def show_icon(path):
    # StatusIcon shrinks images to a stock size (16/24/32/48). The SVGs keep a transparent
    # margin, so render up to 1/15 larger and crop it away: the microphone keeps the tray's size.
    global icon_path
    icon_path = path
    fit = max([s for s in (16, 24, 32, 48) if s <= icon_size], default=icon_size)
    render = min(icon_size, fit * 16 // 15)
    offset = (render - fit) // 2
    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(path, render, render)
    icon.set_from_pixbuf(pixbuf.new_subpixbuf(offset, offset, fit, fit))


def resized(icon, size):
    global icon_size
    icon_size = size
    show_icon(icon_path)
    return True


icon = Gtk.StatusIcon()
show_icon(idle_icon)
icon.connect("size-changed", resized)
icon.set_title("Voice Type")
icon.set_tooltip_text("Voice Type: chưa thu âm (click trái để bật)")
icon.connect("activate", lambda icon: emit("toggle"))
icon.connect("popup-menu", lambda icon, button, time:
             menu.popup(None, None, Gtk.StatusIcon.position_menu, icon, button, time))


def parent_input(fd, condition):
    global pending
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
        recording = bool(json.loads(line)["recording"])
        show_icon(recording_icon if recording else idle_icon)
        icon.set_tooltip_text("Voice Type: đang thu âm (click trái để tắt)" if recording
                              else "Voice Type: chưa thu âm (click trái để bật)")
    return True


GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, parent_input)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: (Gtk.main_quit(), False)[1])
emit("ready")
Gtk.main()
