/*
Adapted for Voice Type from codex-chatgpt-web (5353ee0).
MIT License

Copyright (c) 2026 codex-chatgpt-web contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// Only preloaded into the owned Ubuntu Chrome. A system title bar routes X/Alt+F4 through
// WM_DELETE_WINDOW, before Chrome can unload a tab (including one still loading).
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <xcb/xcb.h>

#define EXPORT __attribute__((visibility("default")))
#define WINDOW_CLASS "voice-type-chrome"

typedef struct {
  xcb_connection_t *connection;
  xcb_atom_t protocols, delete_window, pid, window_type, normal, hidden, saved_state;
  xcb_atom_t state, state_hidden, state_focused, active_window;
} Control;

static xcb_atom_t atom(xcb_connection_t *c, const char *name) {
  xcb_intern_atom_reply_t *reply = xcb_intern_atom_reply(
      c, xcb_intern_atom(c, 0, strlen(name), name), NULL);
  xcb_atom_t result = reply ? reply->atom : XCB_ATOM_NONE;
  free(reply);
  return result;
}

static int open_control(Control *control) {
  xcb_connection_t *c = control->connection = xcb_connect(NULL, NULL);
  if (xcb_connection_has_error(c)) {
    xcb_disconnect(c);
    control->connection = NULL;
    return 0;
  }
  control->protocols = atom(c, "WM_PROTOCOLS");
  control->delete_window = atom(c, "WM_DELETE_WINDOW");
  control->pid = atom(c, "_NET_WM_PID");
  control->window_type = atom(c, "_NET_WM_WINDOW_TYPE");
  control->normal = atom(c, "_NET_WM_WINDOW_TYPE_NORMAL");
  control->hidden = atom(c, "_VOICE_TYPE_HIDDEN");
  control->saved_state = atom(c, "_VOICE_TYPE_SAVED_STATE");
  control->state = atom(c, "_NET_WM_STATE");
  control->state_hidden = atom(c, "_NET_WM_STATE_HIDDEN");
  control->state_focused = atom(c, "_NET_WM_STATE_FOCUSED");
  control->active_window = atom(c, "_NET_ACTIVE_WINDOW");
  return 1;
}

static xcb_get_property_reply_t *property(Control *control, xcb_window_t window,
                                        xcb_atom_t name, xcb_atom_t type) {
  return xcb_get_property_reply(control->connection,
      xcb_get_property(control->connection, 0, window, name, type, 0, 1024), NULL);
}

static int cardinal_is(Control *control, xcb_window_t window, xcb_atom_t name, uint32_t value) {
  xcb_get_property_reply_t *reply = property(control, window, name, XCB_ATOM_CARDINAL);
  int matches = reply && reply->format == 32 && xcb_get_property_value_length(reply) == 4
      && *(uint32_t *)xcb_get_property_value(reply) == value;
  free(reply);
  return matches;
}

static int owned_window(Control *control, xcb_window_t window, uint32_t pid) {
  if (!cardinal_is(control, window, control->pid, pid)) return 0;
  xcb_get_property_reply_t *reply = property(control, window, XCB_ATOM_WM_CLASS, XCB_ATOM_STRING);
  int matches = 0;
  if (reply && reply->format == 8 && reply->bytes_after == 0) {
    const char *value = xcb_get_property_value(reply);
    size_t length = xcb_get_property_value_length(reply);
    size_t instance_length = strnlen(value, length);
    if (instance_length < length) {
      value += instance_length + 1;
      length -= instance_length + 1;
      matches = length == sizeof(WINDOW_CLASS) && !memcmp(value, WINDOW_CLASS, sizeof(WINDOW_CLASS));
    }
  }
  free(reply);
  if (!matches) return 0;
  // Native dialogs must retain their normal close behavior.
  reply = property(control, window, control->window_type, XCB_ATOM_ATOM);
  matches = reply && reply->format == 32 && xcb_get_property_value_length(reply) >= 4
      && *(xcb_atom_t *)xcb_get_property_value(reply) == control->normal;
  free(reply);
  return matches;
}

static void hide_window(Control *control, xcb_window_t window) {
  xcb_connection_t *c = control->connection;
  // A withdrawn window can lose its WM state. Preserve maximization/fullscreen/above, etc.
  xcb_get_property_reply_t *reply = property(control, window, control->state, XCB_ATOM_ATOM);
  xcb_atom_t saved[64];
  unsigned count = 0;
  if (reply && reply->format == 32) {
    xcb_atom_t *states = xcb_get_property_value(reply);
    unsigned length = xcb_get_property_value_length(reply) / sizeof(xcb_atom_t);
    for (unsigned i = 0; i < length && count < 64; ++i) {
      if (states[i] != control->state_hidden && states[i] != control->state_focused)
        saved[count++] = states[i];
    }
  }
  free(reply);
  xcb_change_property(c, XCB_PROP_MODE_REPLACE, window, control->saved_state, XCB_ATOM_ATOM, 32, count, saved);
  uint32_t pid = getpid();
  xcb_change_property(c, XCB_PROP_MODE_REPLACE, window, control->hidden, XCB_ATOM_CARDINAL, 32, 1, &pid);
  xcb_unmap_window(c, window);
  xcb_flush(c);
}

static int intercept(xcb_generic_event_t *event) {
  if ((event->response_type & 127) != XCB_CLIENT_MESSAGE) return 0;
  xcb_client_message_event_t *message = (void *)event;
  if (message->format != 32) return 0;
  // Never inject requests on Chromium's XCB connection: its own request sequence accounting
  // would become inconsistent. Each polling thread has a separate control connection.
  static _Thread_local Control control;
  if (!control.connection && !open_control(&control)) return 0;
  if (message->type != control.protocols || message->data.data32[0] != control.delete_window
      || !owned_window(&control, message->window, getpid())) return 0;
  hide_window(&control, message->window);
  return 1;
}

#define WRAP_POLL(name) \
  EXPORT xcb_generic_event_t *name(xcb_connection_t *connection) { \
    static _Thread_local xcb_generic_event_t *(*next)(xcb_connection_t *); \
    if (!next) next = dlsym(RTLD_NEXT, #name); \
    if (!next) return NULL; \
    xcb_generic_event_t *event; \
    while ((event = next(connection)) && intercept(event)) free(event); \
    return event; \
  }
WRAP_POLL(xcb_poll_for_event)
WRAP_POLL(xcb_poll_for_queued_event)
WRAP_POLL(xcb_wait_for_event)

static int restore_children(Control *control, xcb_window_t parent, uint32_t pid,
                            unsigned depth, xcb_window_t *last) {
  xcb_connection_t *c = control->connection;
  xcb_query_tree_reply_t *tree = xcb_query_tree_reply(c, xcb_query_tree(c, parent), NULL);
  if (!tree) return 0;
  int count = 0;
  xcb_window_t *children = xcb_query_tree_children(tree);
  for (int i = 0; i < xcb_query_tree_children_length(tree); ++i) {
    xcb_window_t window = children[i];
    if (cardinal_is(control, window, control->hidden, pid) && owned_window(control, window, pid)) {
      xcb_get_property_reply_t *saved = property(control, window, control->saved_state, XCB_ATOM_ATOM);
      if (saved && saved->format == 32) {
        xcb_change_property(c, XCB_PROP_MODE_REPLACE, window, control->state, XCB_ATOM_ATOM,
                            32, xcb_get_property_value_length(saved) / 4, xcb_get_property_value(saved));
      }
      free(saved);
      xcb_delete_property(c, window, control->saved_state);
      xcb_delete_property(c, window, control->hidden);
      xcb_map_window(c, window);
      *last = window;
      ++count;
    } else if (depth) {
      // The WM may not have removed its frame yet when the tray is clicked immediately.
      count += restore_children(control, window, pid, depth - 1, last);
    }
  }
  free(tree);
  return count;
}

// Called by the owning bridge only after an explicit tray/open-window request.
EXPORT int voice_type_restore(uint32_t pid) {
  Control control = {0};
  if (!open_control(&control)) return -1;
  xcb_connection_t *c = control.connection;
  xcb_window_t root = xcb_setup_roots_iterator(xcb_get_setup(c)).data->root;
  xcb_window_t last = XCB_WINDOW_NONE;
  int count = restore_children(&control, root, pid, 1, &last);
  if (last) {
    xcb_client_message_event_t activate = {0};
    activate.response_type = XCB_CLIENT_MESSAGE;
    activate.format = 32;
    activate.window = last;
    activate.type = control.active_window;
    activate.data.data32[0] = 2; // Explicit desktop/tray action.
    xcb_send_event(c, 0, root, XCB_EVENT_MASK_SUBSTRUCTURE_REDIRECT | XCB_EVENT_MASK_SUBSTRUCTURE_NOTIFY,
                   (const char *)&activate);
  }
  // Wait for server processing before disconnecting the short-lived control connection.
  free(xcb_get_input_focus_reply(c, xcb_get_input_focus(c), NULL));
  xcb_disconnect(c);
  return count;
}

#ifdef VOICE_TYPE_HELPER
#include <stdio.h>
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  char *end;
  unsigned long pid = strtoul(argv[1], &end, 10);
  if (*end || !pid || pid > UINT32_MAX) return 2;
  int count = voice_type_restore((uint32_t)pid);
  if (count < 0) return 1;
  printf("%d\n", count);
  return 0;
}
#endif
