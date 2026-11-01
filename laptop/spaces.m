/* Her window kept to one desktop: the one setting Electron does not offer.

   macOS puts a window raised above the others on every desktop unless the
   window says otherwise — a window at any level but the normal one floats
   across them by default. She is raised, to sit on his chart, so without this
   she shows wherever he goes. Managed is the default the normal level gets:
   the window belongs to one desktop and macOS moves it with that desktop.
   Electron changes the desktop flags one at a time and leaves this one as it
   is. Built by `npm run package` and asked by the workflow on a Mac whether it
   took. */
#include <node_api.h>
#import <AppKit/AppKit.h>

// The handle is getNativeWindowHandle()'s: a buffer holding her NSView.
static napi_value managed(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value handle, out;
  void *bytes;
  size_t length;
  napi_get_cb_info(env, info, &argc, &handle, NULL, NULL);
  napi_get_buffer_info(env, handle, &bytes, &length);
  NSWindow *window = [*(NSView **)bytes window];
  window.collectionBehavior = (window.collectionBehavior & ~NSWindowCollectionBehaviorTransient) |
    NSWindowCollectionBehaviorManaged;
  napi_create_uint32(env, (uint32_t)window.collectionBehavior, &out);
  return out;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "managed", NAPI_AUTO_LENGTH, managed, NULL, &fn);
  napi_set_named_property(env, exports, "managed", fn);
  return exports;
}
