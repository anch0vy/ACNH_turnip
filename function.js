// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module !== 'undefined' ? Module : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// {{PRE_JSES}}

// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

var arguments_ = [];
var thisProgram = './this.program';
var quit_ = function(status, toThrow) {
  throw toThrow;
};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string';
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (Module['ENVIRONMENT']) {
  throw new Error('Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -s ENVIRONMENT=web or -s ENVIRONMENT=node)');
}



// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var read_,
    readAsync,
    readBinary,
    setWindowTitle;

var nodeFS;
var nodePath;

if (ENVIRONMENT_IS_NODE) {
  if (ENVIRONMENT_IS_WORKER) {
    scriptDirectory = require('path').dirname(scriptDirectory) + '/';
  } else {
    scriptDirectory = __dirname + '/';
  }


  read_ = function shell_read(filename, binary) {
    var ret = tryParseAsDataURI(filename);
    if (ret) {
      return binary ? ret : ret.toString();
    }
    if (!nodeFS) nodeFS = require('fs');
    if (!nodePath) nodePath = require('path');
    filename = nodePath['normalize'](filename);
    return nodeFS['readFileSync'](filename, binary ? null : 'utf8');
  };

  readBinary = function readBinary(filename) {
    var ret = read_(filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };




  if (process['argv'].length > 1) {
    thisProgram = process['argv'][1].replace(/\\/g, '/');
  }

  arguments_ = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });

  process['on']('unhandledRejection', abort);

  quit_ = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };



} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    read_ = function shell_read(f) {
      var data = tryParseAsDataURI(f);
      if (data) {
        return intArrayToString(data);
      }
      return read(f);
    };
  }

  readBinary = function readBinary(f) {
    var data;
    data = tryParseAsDataURI(f);
    if (data) {
      return data;
    }
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    arguments_ = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    arguments_ = arguments;
  }

  if (typeof quit === 'function') {
    quit_ = function(status) {
      quit(status);
    };
  }

  if (typeof print !== 'undefined') {
    // Prefer to use print/printErr where they exist, as they usually work better.
    if (typeof console === 'undefined') console = /** @type{!Console} */({});
    console.log = /** @type{!function(this:Console, ...*): undefined} */ (print);
    console.warn = console.error = /** @type{!function(this:Console, ...*): undefined} */ (typeof printErr !== 'undefined' ? printErr : print);
  }


} else

// Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  // Differentiate the Web Worker from the Node Worker case, as reading must
  // be done differently.
  {


  read_ = function shell_read(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
    } catch (err) {
      var data = tryParseAsDataURI(url);
      if (data) {
        return intArrayToString(data);
      }
      throw err;
    }
  };

  if (ENVIRONMENT_IS_WORKER) {
    readBinary = function readBinary(url) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(/** @type{!ArrayBuffer} */(xhr.response));
      } catch (err) {
        var data = tryParseAsDataURI(url);
        if (data) {
          return data;
        }
        throw err;
      }
    };
  }

  readAsync = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      var data = tryParseAsDataURI(url);
      if (data) {
        onload(data.buffer);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };




  }

  setWindowTitle = function(title) { document.title = title };
} else
{
  throw new Error('environment detection error');
}


// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
var out = Module['print'] || console.log.bind(console);
var err = Module['printErr'] || console.warn.bind(console);

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = null;

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
if (Module['arguments']) arguments_ = Module['arguments'];if (!Object.getOwnPropertyDescriptor(Module, 'arguments')) Object.defineProperty(Module, 'arguments', { configurable: true, get: function() { abort('Module.arguments has been replaced with plain arguments_') } });
if (Module['thisProgram']) thisProgram = Module['thisProgram'];if (!Object.getOwnPropertyDescriptor(Module, 'thisProgram')) Object.defineProperty(Module, 'thisProgram', { configurable: true, get: function() { abort('Module.thisProgram has been replaced with plain thisProgram') } });
if (Module['quit']) quit_ = Module['quit'];if (!Object.getOwnPropertyDescriptor(Module, 'quit')) Object.defineProperty(Module, 'quit', { configurable: true, get: function() { abort('Module.quit has been replaced with plain quit_') } });

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
// Assertions on removed incoming Module JS APIs.
assert(typeof Module['memoryInitializerPrefixURL'] === 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['pthreadMainPrefixURL'] === 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['cdInitializerPrefixURL'] === 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['filePackagePrefixURL'] === 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['read'] === 'undefined', 'Module.read option was removed (modify read_ in JS)');
assert(typeof Module['readAsync'] === 'undefined', 'Module.readAsync option was removed (modify readAsync in JS)');
assert(typeof Module['readBinary'] === 'undefined', 'Module.readBinary option was removed (modify readBinary in JS)');
assert(typeof Module['setWindowTitle'] === 'undefined', 'Module.setWindowTitle option was removed (modify setWindowTitle in JS)');
assert(typeof Module['TOTAL_MEMORY'] === 'undefined', 'Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY');
if (!Object.getOwnPropertyDescriptor(Module, 'read')) Object.defineProperty(Module, 'read', { configurable: true, get: function() { abort('Module.read has been replaced with plain read_') } });
if (!Object.getOwnPropertyDescriptor(Module, 'readAsync')) Object.defineProperty(Module, 'readAsync', { configurable: true, get: function() { abort('Module.readAsync has been replaced with plain readAsync') } });
if (!Object.getOwnPropertyDescriptor(Module, 'readBinary')) Object.defineProperty(Module, 'readBinary', { configurable: true, get: function() { abort('Module.readBinary has been replaced with plain readBinary') } });
// TODO: add when SDL2 is fixed if (!Object.getOwnPropertyDescriptor(Module, 'setWindowTitle')) Object.defineProperty(Module, 'setWindowTitle', { configurable: true, get: function() { abort('Module.setWindowTitle has been replaced with plain setWindowTitle') } });
var IDBFS = 'IDBFS is no longer included by default; build with -lidbfs.js';
var PROXYFS = 'PROXYFS is no longer included by default; build with -lproxyfs.js';
var WORKERFS = 'WORKERFS is no longer included by default; build with -lworkerfs.js';
var NODEFS = 'NODEFS is no longer included by default; build with -lnodefs.js';


// TODO remove when SDL2 is fixed (also see above)



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;

// stack management, and other functionality that is provided by the compiled code,
// should not be used before it is ready

/** @suppress{duplicate} */
var stackSave;
/** @suppress{duplicate} */
var stackRestore;
/** @suppress{duplicate} */
var stackAlloc;

stackSave = stackRestore = stackAlloc = function() {
  abort('cannot use the stack before compiled code is ready to run, and has provided stack access');
};

function staticAlloc(size) {
  abort('staticAlloc is no longer available at runtime; instead, perform static allocations at compile time (using makeStaticAlloc)');
}

function dynamicAlloc(size) {
  assert(DYNAMICTOP_PTR);
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  assert(end <= HEAP8.length, 'failure to dynamicAlloc - memory growth etc. is not supported there, call malloc/sbrk directly');
  HEAP32[DYNAMICTOP_PTR>>2] = end;
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = Number(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}






// Wraps a JS function as a wasm function with a given signature.
function convertJsFunctionToWasm(func, sig) {
  return func;
}

var freeTableIndexes = [];

// Add a wasm function to the table.
function addFunctionWasm(func, sig) {
  var table = wasmTable;
  var ret;
  // Reuse a free index if there is one, otherwise grow.
  if (freeTableIndexes.length) {
    ret = freeTableIndexes.pop();
  } else {
    ret = table.length;
    // Grow the table
    try {
      table.grow(1);
    } catch (err) {
      if (!(err instanceof RangeError)) {
        throw err;
      }
      throw 'Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.';
    }
  }

  // Set the new value.
  try {
    // Attempting to call this with JS function will cause of table.set() to fail
    table.set(ret, func);
  } catch (err) {
    if (!(err instanceof TypeError)) {
      throw err;
    }
    assert(typeof sig !== 'undefined', 'Missing signature argument to addFunction');
    var wrapped = convertJsFunctionToWasm(func, sig);
    table.set(ret, wrapped);
  }

  return ret;
}

function removeFunctionWasm(index) {
  freeTableIndexes.push(index);
}

// 'sig' parameter is required for the llvm backend but only when func is not
// already a WebAssembly function.
function addFunction(func, sig) {
  assert(typeof func !== 'undefined');

  return addFunctionWasm(func, sig);
}

function removeFunction(index) {
  removeFunctionWasm(index);
}



var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}





function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

/** @param {Array=} args */
function dynCall(sig, ptr, args) {
  if (args && args.length) {
    // j (64-bit integer) must be passed in as two numbers [low 32, high 32].
    assert(args.length === sig.substring(1).replace(/j/g, '--').length);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    assert(sig.length == 1);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
};

var getTempRet0 = function() {
  return tempRet0;
};

function getCompilerSetting(name) {
  throw 'You must build with -s RETAIN_COMPILER_SETTINGS=1 for getCompilerSetting or emscripten_get_compiler_setting to work';
}

var Runtime = {
  // helpful errors
  getTempRet0: function() { abort('getTempRet0() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  staticAlloc: function() { abort('staticAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  stackAlloc: function() { abort('stackAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 1024;




// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html


var wasmBinary;if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];if (!Object.getOwnPropertyDescriptor(Module, 'wasmBinary')) Object.defineProperty(Module, 'wasmBinary', { configurable: true, get: function() { abort('Module.wasmBinary has been replaced with plain wasmBinary') } });
var noExitRuntime;if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];if (!Object.getOwnPropertyDescriptor(Module, 'noExitRuntime')) Object.defineProperty(Module, 'noExitRuntime', { configurable: true, get: function() { abort('Module.noExitRuntime has been replaced with plain noExitRuntime') } });


// wasm2js.js - enough of a polyfill for the WebAssembly object so that we can load
// wasm2js code that way.


// Emit "var WebAssembly" if definitely using wasm2js. Otherwise, in MAYBE_WASM2JS
// mode, we can't use a "var" since it would prevent normal wasm from working.
/** @suppress{const} */
var
WebAssembly = {
  Memory: /** @constructor */ function(opts) {
    return {
      buffer: new ArrayBuffer(opts['initial'] * 65536),
      grow: function(amount) {
        var oldBuffer = this.buffer;
        var ret = __growWasmMemory(amount);
        assert(this.buffer !== oldBuffer); // the call should have updated us
        return ret;
      }
    };
  },

  Table: function(opts) {
    var ret = new Array(opts['initial']);
    ret.grow = function(by) {
      if (ret.length >= 31 + 0) {
        abort('Unable to grow wasm table. Use a higher value for RESERVED_FUNCTION_POINTERS or set ALLOW_TABLE_GROWTH.')
      }
      ret.push(null);
    };
    ret.set = function(i, func) {
      ret[i] = func;
    };
    ret.get = function(i) {
      return ret[i];
    };
    return ret;
  },

  Module: function(binary) {
    // TODO: use the binary and info somehow - right now the wasm2js output is embedded in
    // the main JS
    return {};
  },

  Instance: function(module, info) {
    // TODO: use the module and info somehow - right now the wasm2js output is embedded in
    // the main JS
    // This will be replaced by the actual wasm2js code.
    var exports = (
function instantiate(asmLibraryArg, wasmMemory, wasmTable) {

function asmFunc(global, env, buffer) {
 var memory = env.memory;
 var FUNCTION_TABLE = wasmTable;
 var HEAP8 = new global.Int8Array(buffer);
 var HEAP16 = new global.Int16Array(buffer);
 var HEAP32 = new global.Int32Array(buffer);
 var HEAPU8 = new global.Uint8Array(buffer);
 var HEAPU16 = new global.Uint16Array(buffer);
 var HEAPU32 = new global.Uint32Array(buffer);
 var HEAPF32 = new global.Float32Array(buffer);
 var HEAPF64 = new global.Float64Array(buffer);
 var Math_imul = global.Math.imul;
 var Math_fround = global.Math.fround;
 var Math_abs = global.Math.abs;
 var Math_clz32 = global.Math.clz32;
 var Math_min = global.Math.min;
 var Math_max = global.Math.max;
 var Math_floor = global.Math.floor;
 var Math_ceil = global.Math.ceil;
 var Math_sqrt = global.Math.sqrt;
 var abort = env.abort;
 var nan = global.NaN;
 var infinity = global.Infinity;
 var fimport$0 = env._embind_register_class;
 var fimport$1 = env._embind_register_class_property;
 var fimport$2 = env._embind_register_function;
 var fimport$3 = env._embind_register_class_constructor;
 var fimport$4 = env._embind_register_void;
 var fimport$5 = env._embind_register_bool;
 var fimport$6 = env._embind_register_std_string;
 var fimport$7 = env._embind_register_std_wstring;
 var fimport$8 = env._embind_register_emval;
 var fimport$9 = env._embind_register_integer;
 var fimport$10 = env._embind_register_float;
 var fimport$11 = env._embind_register_memory_view;
 var fimport$12 = env.emscripten_resize_heap;
 var fimport$13 = env.emscripten_memcpy_big;
 var fimport$14 = env.__handle_stack_overflow;
 var global$0 = 5247328;
 var global$1 = 4440;
 var global$2 = 0;
 var i64toi32_i32$HIGH_BITS = 0;
 // EMSCRIPTEN_START_FUNCS
;
 function $0() {
  return 4448 | 0;
 }
 
 function $1() {
  $53();
  $226();
 }
 
 function $2($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $5_1 = 0, $4_1 = 0;
  $4_1 = global$0 - 16 | 0;
  HEAP32[($4_1 + 12 | 0) >> 2] = $0_1;
  HEAP32[($4_1 + 8 | 0) >> 2] = $1_1;
  $5_1 = HEAP32[($4_1 + 12 | 0) >> 2] | 0;
  HEAP32[$5_1 >> 2] = Math_imul((HEAP32[($4_1 + 8 | 0) >> 2] | 0) ^ ((HEAP32[($4_1 + 8 | 0) >> 2] | 0) >>> 30 | 0) | 0, 1812433253) + 1 | 0;
  HEAP32[($5_1 + 4 | 0) >> 2] = Math_imul((HEAP32[$5_1 >> 2] | 0) ^ ((HEAP32[$5_1 >> 2] | 0) >>> 30 | 0) | 0, 1812433253) + 2 | 0;
  HEAP32[($5_1 + 8 | 0) >> 2] = Math_imul((HEAP32[($5_1 + 4 | 0) >> 2] | 0) ^ ((HEAP32[($5_1 + 4 | 0) >> 2] | 0) >>> 30 | 0) | 0, 1812433253) + 3 | 0;
  HEAP32[($5_1 + 12 | 0) >> 2] = Math_imul((HEAP32[($5_1 + 8 | 0) >> 2] | 0) ^ ((HEAP32[($5_1 + 8 | 0) >> 2] | 0) >>> 30 | 0) | 0, 1812433253) + 4 | 0;
  return;
 }
 
 function $3($0_1) {
  $0_1 = $0_1 | 0;
  var $4_1 = 0, $3_1 = 0;
  $3_1 = global$0 - 16 | 0;
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $4_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
  HEAP32[($3_1 + 8 | 0) >> 2] = (HEAP32[$4_1 >> 2] | 0) ^ ((HEAP32[$4_1 >> 2] | 0) << 11 | 0) | 0;
  HEAP32[$4_1 >> 2] = HEAP32[($4_1 + 4 | 0) >> 2] | 0;
  HEAP32[($4_1 + 4 | 0) >> 2] = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
  HEAP32[($4_1 + 8 | 0) >> 2] = HEAP32[($4_1 + 12 | 0) >> 2] | 0;
  HEAP32[($4_1 + 12 | 0) >> 2] = (((HEAP32[($3_1 + 8 | 0) >> 2] | 0) ^ ((HEAP32[($3_1 + 8 | 0) >> 2] | 0) >>> 8 | 0) | 0) ^ (HEAP32[($4_1 + 12 | 0) >> 2] | 0) | 0) ^ ((HEAP32[($4_1 + 12 | 0) >> 2] | 0) >>> 19 | 0) | 0;
  return HEAP32[($4_1 + 12 | 0) >> 2] | 0 | 0;
 }
 
 function $4($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $9_1 = 0, $601 = Math_fround(0), $549 = Math_fround(0), $148_1 = 0, $550 = Math_fround(0), $19_1 = 0, $145_1 = 0, $153_1 = 0, $178_1 = 0, $198_1 = 0, $223_1 = 0, $243_1 = 0, $266 = 0, $548 = Math_fround(0), $302 = 0, $312 = 0, $322 = 0, $332 = 0, $342 = 0, $387 = 0, $603 = Math_fround(0), $414 = 0, $424 = 0, $436 = 0, $446 = 0, $458 = 0, $489 = 0, $493 = 0, $492 = 0, $175_1 = 0, $197_1 = 0, $509 = Math_fround(0), $220_1 = 0, $242_1 = 0, $527 = Math_fround(0), $263 = 0, $288 = 0, $545 = Math_fround(0), $299 = 0, $309 = 0, $319 = 0, $329 = 0, $339 = 0, $356 = 0, $575 = Math_fround(0), $377 = 0, $585 = Math_fround(0), $399 = 0, $598 = Math_fround(0), $411 = 0, $421 = 0, $433 = 0, $443 = 0, $455 = 0, $479 = 0, $632 = Math_fround(0);
  $3_1 = global$0 - 80 | 0;
  label$1 : {
   $492 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $492;
  }
  HEAP32[($3_1 + 76 | 0) >> 2] = $0_1;
  $9_1 = HEAP32[($3_1 + 76 | 0) >> 2] | 0;
  HEAP32[$9_1 >> 2] = $5($9_1 | 0, 90 | 0, 110 | 0) | 0;
  HEAP32[($3_1 + 72 | 0) >> 2] = $5($9_1 | 0, 0 | 0, 99 | 0) | 0;
  label$3 : {
   label$4 : {
    if (!((HEAP32[($9_1 + 60 | 0) >> 2] | 0) >>> 0 >= 4 >>> 0 & 1 | 0)) {
     break label$4
    }
    HEAP32[($3_1 + 68 | 0) >> 2] = 2;
    break label$3;
   }
   $19_1 = HEAP32[($9_1 + 60 | 0) >> 2] | 0;
   label$5 : {
    if ($19_1 >>> 0 > 3 >>> 0) {
     break label$5
    }
    label$6 : {
     switch ($19_1 | 0) {
     default:
      label$10 : {
       label$11 : {
        if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (20 | 0) & 1 | 0)) {
         break label$11
        }
        HEAP32[($3_1 + 68 | 0) >> 2] = 0;
        break label$10;
       }
       label$12 : {
        label$13 : {
         if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (50 | 0) & 1 | 0)) {
          break label$13
         }
         HEAP32[($3_1 + 68 | 0) >> 2] = 1;
         break label$12;
        }
        label$14 : {
         label$15 : {
          if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (65 | 0) & 1 | 0)) {
           break label$15
          }
          HEAP32[($3_1 + 68 | 0) >> 2] = 2;
          break label$14;
         }
         HEAP32[($3_1 + 68 | 0) >> 2] = 3;
        }
       }
      }
      break label$5;
     case 1:
      label$16 : {
       label$17 : {
        if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (50 | 0) & 1 | 0)) {
         break label$17
        }
        HEAP32[($3_1 + 68 | 0) >> 2] = 0;
        break label$16;
       }
       label$18 : {
        label$19 : {
         if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (55 | 0) & 1 | 0)) {
          break label$19
         }
         HEAP32[($3_1 + 68 | 0) >> 2] = 1;
         break label$18;
        }
        label$20 : {
         label$21 : {
          if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (75 | 0) & 1 | 0)) {
           break label$21
          }
          HEAP32[($3_1 + 68 | 0) >> 2] = 2;
          break label$20;
         }
         HEAP32[($3_1 + 68 | 0) >> 2] = 3;
        }
       }
      }
      break label$5;
     case 2:
      label$22 : {
       label$23 : {
        if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (25 | 0) & 1 | 0)) {
         break label$23
        }
        HEAP32[($3_1 + 68 | 0) >> 2] = 0;
        break label$22;
       }
       label$24 : {
        label$25 : {
         if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (70 | 0) & 1 | 0)) {
          break label$25
         }
         HEAP32[($3_1 + 68 | 0) >> 2] = 1;
         break label$24;
        }
        label$26 : {
         label$27 : {
          if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (75 | 0) & 1 | 0)) {
           break label$27
          }
          HEAP32[($3_1 + 68 | 0) >> 2] = 2;
          break label$26;
         }
         HEAP32[($3_1 + 68 | 0) >> 2] = 3;
        }
       }
      }
      break label$5;
     case 3:
      break label$6;
     };
    }
    label$28 : {
     label$29 : {
      if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (45 | 0) & 1 | 0)) {
       break label$29
      }
      HEAP32[($3_1 + 68 | 0) >> 2] = 0;
      break label$28;
     }
     label$30 : {
      label$31 : {
       if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (70 | 0) & 1 | 0)) {
        break label$31
       }
       HEAP32[($3_1 + 68 | 0) >> 2] = 1;
       break label$30;
      }
      label$32 : {
       label$33 : {
        if (!((HEAP32[($3_1 + 72 | 0) >> 2] | 0 | 0) < (85 | 0) & 1 | 0)) {
         break label$33
        }
        HEAP32[($3_1 + 68 | 0) >> 2] = 2;
        break label$32;
       }
       HEAP32[($3_1 + 68 | 0) >> 2] = 3;
      }
     }
    }
   }
  }
  HEAP32[($9_1 + 60 | 0) >> 2] = HEAP32[($3_1 + 68 | 0) >> 2] | 0;
  HEAP32[($3_1 + 64 | 0) >> 2] = 2;
  label$34 : {
   label$35 : while (1) {
    if (!((HEAP32[($3_1 + 64 | 0) >> 2] | 0 | 0) < (14 | 0) & 1 | 0)) {
     break label$34
    }
    HEAP32[(($9_1 + 4 | 0) + ((HEAP32[($3_1 + 64 | 0) >> 2] | 0) << 2 | 0) | 0) >> 2] = 0;
    HEAP32[($3_1 + 64 | 0) >> 2] = (HEAP32[($3_1 + 64 | 0) >> 2] | 0) + 1 | 0;
    continue label$35;
   };
  }
  HEAP32[($9_1 + 4 | 0) >> 2] = HEAP32[$9_1 >> 2] | 0;
  HEAP32[($9_1 + 8 | 0) >> 2] = HEAP32[$9_1 >> 2] | 0;
  $145_1 = HEAP32[($9_1 + 60 | 0) >> 2] | 0;
  label$36 : {
   if ($145_1 >>> 0 > 3 >>> 0) {
    break label$36
   }
   label$37 : {
    switch ($145_1 | 0) {
    default:
     $148_1 = 0;
     $153_1 = 2;
     HEAP32[($3_1 + 60 | 0) >> 2] = $153_1;
     HEAP32[($3_1 + 56 | 0) >> 2] = ($6($9_1 | 0) | 0) & 1 | 0 ? 3 : $153_1;
     HEAP32[($3_1 + 52 | 0) >> 2] = 5 - (HEAP32[($3_1 + 56 | 0) >> 2] | 0) | 0;
     HEAP32[($3_1 + 44 | 0) >> 2] = $5($9_1 | 0, $148_1 | 0, 6 | 0) | 0;
     HEAP32[($3_1 + 40 | 0) >> 2] = 7 - (HEAP32[($3_1 + 44 | 0) >> 2] | 0) | 0;
     HEAP32[($3_1 + 36 | 0) >> 2] = $5($9_1 | 0, $148_1 | 0, (HEAP32[($3_1 + 40 | 0) >> 2] | 0) - 1 | 0 | 0) | 0;
     HEAP32[($3_1 + 28 | 0) >> 2] = $148_1;
     label$41 : {
      label$42 : while (1) {
       if (!((HEAP32[($3_1 + 28 | 0) >> 2] | 0 | 0) < (HEAP32[($3_1 + 44 | 0) >> 2] | 0 | 0) & 1 | 0)) {
        break label$41
       }
       $175_1 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround(Math_fround(.8999999761581421)), Math_fround(Math_fround(1.399999976158142)))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       $178_1 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
       HEAP32[($3_1 + 60 | 0) >> 2] = $178_1 + 1 | 0;
       HEAP32[(($9_1 + 4 | 0) + ($178_1 << 2 | 0) | 0) >> 2] = $175_1;
       HEAP32[($3_1 + 28 | 0) >> 2] = (HEAP32[($3_1 + 28 | 0) >> 2] | 0) + 1 | 0;
       continue label$42;
      };
     }
     HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround($7($9_1 | 0, Math_fround(Math_fround(.800000011920929)), Math_fround(Math_fround(.6000000238418579))));
     HEAP32[($3_1 + 24 | 0) >> 2] = 0;
     label$43 : {
      label$44 : while (1) {
       if (!((HEAP32[($3_1 + 24 | 0) >> 2] | 0 | 0) < (HEAP32[($3_1 + 56 | 0) >> 2] | 0 | 0) & 1 | 0)) {
        break label$43
       }
       $197_1 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       $198_1 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
       HEAP32[($3_1 + 60 | 0) >> 2] = $198_1 + 1 | 0;
       HEAP32[(($9_1 + ($198_1 << 2 | 0) | 0) + 4 | 0) >> 2] = $197_1;
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(+Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) + -.04);
       $509 = Math_fround($7($9_1 | 0, Math_fround(Math_fround(0 | 0)), Math_fround(Math_fround(.05999999865889549))));
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) - $509);
       HEAP32[($3_1 + 24 | 0) >> 2] = (HEAP32[($3_1 + 24 | 0) >> 2] | 0) + 1 | 0;
       continue label$44;
      };
     }
     HEAP32[($3_1 + 20 | 0) >> 2] = 0;
     label$45 : {
      label$46 : while (1) {
       if (!((HEAP32[($3_1 + 20 | 0) >> 2] | 0 | 0) < ((HEAP32[($3_1 + 40 | 0) >> 2] | 0) - (HEAP32[($3_1 + 36 | 0) >> 2] | 0) | 0 | 0) & 1 | 0)) {
        break label$45
       }
       $220_1 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround(Math_fround(.8999999761581421)), Math_fround(Math_fround(1.399999976158142)))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       $223_1 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
       HEAP32[($3_1 + 60 | 0) >> 2] = $223_1 + 1 | 0;
       HEAP32[(($9_1 + 4 | 0) + ($223_1 << 2 | 0) | 0) >> 2] = $220_1;
       HEAP32[($3_1 + 20 | 0) >> 2] = (HEAP32[($3_1 + 20 | 0) >> 2] | 0) + 1 | 0;
       continue label$46;
      };
     }
     HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround($7($9_1 | 0, Math_fround(Math_fround(.800000011920929)), Math_fround(Math_fround(.6000000238418579))));
     HEAP32[($3_1 + 16 | 0) >> 2] = 0;
     label$47 : {
      label$48 : while (1) {
       if (!((HEAP32[($3_1 + 16 | 0) >> 2] | 0 | 0) < (HEAP32[($3_1 + 52 | 0) >> 2] | 0 | 0) & 1 | 0)) {
        break label$47
       }
       $242_1 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       $243_1 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
       HEAP32[($3_1 + 60 | 0) >> 2] = $243_1 + 1 | 0;
       HEAP32[(($9_1 + ($243_1 << 2 | 0) | 0) + 4 | 0) >> 2] = $242_1;
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(+Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) + -.04);
       $527 = Math_fround($7($9_1 | 0, Math_fround(Math_fround(0 | 0)), Math_fround(Math_fround(.05999999865889549))));
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) - $527);
       HEAP32[($3_1 + 16 | 0) >> 2] = (HEAP32[($3_1 + 16 | 0) >> 2] | 0) + 1 | 0;
       continue label$48;
      };
     }
     HEAP32[($3_1 + 12 | 0) >> 2] = 0;
     label$49 : {
      label$50 : while (1) {
       if (!((HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0) < (HEAP32[($3_1 + 36 | 0) >> 2] | 0 | 0) & 1 | 0)) {
        break label$49
       }
       $263 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround(Math_fround(.8999999761581421)), Math_fround(Math_fround(1.399999976158142)))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       $266 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
       HEAP32[($3_1 + 60 | 0) >> 2] = $266 + 1 | 0;
       HEAP32[(($9_1 + 4 | 0) + ($266 << 2 | 0) | 0) >> 2] = $263;
       HEAP32[($3_1 + 12 | 0) >> 2] = (HEAP32[($3_1 + 12 | 0) >> 2] | 0) + 1 | 0;
       continue label$50;
      };
     }
     break label$36;
    case 1:
     HEAP32[($3_1 + 48 | 0) >> 2] = $5($9_1 | 0, 3 | 0, 9 | 0) | 0;
     HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround($7($9_1 | 0, Math_fround(Math_fround(.8999999761581421)), Math_fround(Math_fround(.8500000238418579))));
     HEAP32[($3_1 + 60 | 0) >> 2] = 2;
     label$51 : {
      label$52 : while (1) {
       if (!((HEAP32[($3_1 + 60 | 0) >> 2] | 0 | 0) < (HEAP32[($3_1 + 48 | 0) >> 2] | 0 | 0) & 1 | 0)) {
        break label$51
       }
       $288 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       HEAP32[(($9_1 + ((HEAP32[($3_1 + 60 | 0) >> 2] | 0) << 2 | 0) | 0) + 4 | 0) >> 2] = $288;
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(+Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) + -.03);
       $545 = Math_fround($7($9_1 | 0, Math_fround(Math_fround(0 | 0)), Math_fround(Math_fround(.019999999552965164))));
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) - $545);
       HEAP32[($3_1 + 60 | 0) >> 2] = (HEAP32[($3_1 + 60 | 0) >> 2] | 0) + 1 | 0;
       continue label$52;
      };
     }
     $548 = Math_fround(.8999999761581421);
     $549 = Math_fround(1.399999976158142);
     $550 = Math_fround(2.0);
     $299 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($548), Math_fround($549))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
     $302 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
     HEAP32[($3_1 + 60 | 0) >> 2] = $302 + 1 | 0;
     HEAP32[(($9_1 + 4 | 0) + ($302 << 2 | 0) | 0) >> 2] = $299;
     $309 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($549), Math_fround($550))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
     $312 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
     HEAP32[($3_1 + 60 | 0) >> 2] = $312 + 1 | 0;
     HEAP32[(($9_1 + 4 | 0) + ($312 << 2 | 0) | 0) >> 2] = $309;
     $319 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($550), Math_fround(Math_fround(6.0)))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
     $322 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
     HEAP32[($3_1 + 60 | 0) >> 2] = $322 + 1 | 0;
     HEAP32[(($9_1 + 4 | 0) + ($322 << 2 | 0) | 0) >> 2] = $319;
     $329 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($549), Math_fround($550))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
     $332 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
     HEAP32[($3_1 + 60 | 0) >> 2] = $332 + 1 | 0;
     HEAP32[(($9_1 + 4 | 0) + ($332 << 2 | 0) | 0) >> 2] = $329;
     $339 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($548), Math_fround($549))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
     $342 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
     HEAP32[($3_1 + 60 | 0) >> 2] = $342 + 1 | 0;
     HEAP32[(($9_1 + 4 | 0) + ($342 << 2 | 0) | 0) >> 2] = $339;
     label$53 : {
      label$54 : while (1) {
       if (!((HEAP32[($3_1 + 60 | 0) >> 2] | 0 | 0) < (14 | 0) & 1 | 0)) {
        break label$53
       }
       $356 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround(Math_fround(.4000000059604645)), Math_fround(Math_fround(.8999999761581421)))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       HEAP32[(($9_1 + 4 | 0) + ((HEAP32[($3_1 + 60 | 0) >> 2] | 0) << 2 | 0) | 0) >> 2] = $356;
       HEAP32[($3_1 + 60 | 0) >> 2] = (HEAP32[($3_1 + 60 | 0) >> 2] | 0) + 1 | 0;
       continue label$54;
      };
     }
     break label$36;
    case 2:
     HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(.8999999761581421);
     $575 = Math_fround($7($9_1 | 0, Math_fround(Math_fround(0 | 0)), Math_fround(Math_fround(.05000000074505806))));
     HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) - $575);
     HEAP32[($3_1 + 60 | 0) >> 2] = 2;
     label$55 : {
      label$56 : while (1) {
       if (!((HEAP32[($3_1 + 60 | 0) >> 2] | 0 | 0) < (14 | 0) & 1 | 0)) {
        break label$55
       }
       $377 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
       HEAP32[(($9_1 + ((HEAP32[($3_1 + 60 | 0) >> 2] | 0) << 2 | 0) | 0) + 4 | 0) >> 2] = $377;
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(+Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) + -.03);
       $585 = Math_fround($7($9_1 | 0, Math_fround(Math_fround(0 | 0)), Math_fround(Math_fround(.019999999552965164))));
       HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) - $585);
       HEAP32[($3_1 + 60 | 0) >> 2] = (HEAP32[($3_1 + 60 | 0) >> 2] | 0) + 1 | 0;
       continue label$56;
      };
     }
     break label$36;
    case 3:
     break label$37;
    };
   }
   $387 = 2;
   HEAP32[($3_1 + 48 | 0) >> 2] = $5($9_1 | 0, $387 | 0, 9 | 0) | 0;
   HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround($7($9_1 | 0, Math_fround(Math_fround(.8999999761581421)), Math_fround(Math_fround(.4000000059604645))));
   HEAP32[($3_1 + 60 | 0) >> 2] = $387;
   label$57 : {
    label$58 : while (1) {
     if (!((HEAP32[($3_1 + 60 | 0) >> 2] | 0 | 0) < (HEAP32[($3_1 + 48 | 0) >> 2] | 0 | 0) & 1 | 0)) {
      break label$57
     }
     $399 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
     HEAP32[(($9_1 + ((HEAP32[($3_1 + 60 | 0) >> 2] | 0) << 2 | 0) | 0) + 4 | 0) >> 2] = $399;
     HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(+Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) + -.03);
     $598 = Math_fround($7($9_1 | 0, Math_fround(Math_fround(0 | 0)), Math_fround(Math_fround(.019999999552965164))));
     HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) - $598);
     HEAP32[($3_1 + 60 | 0) >> 2] = (HEAP32[($3_1 + 60 | 0) >> 2] | 0) + 1 | 0;
     continue label$58;
    };
   }
   $601 = Math_fround(1.399999976158142);
   $603 = Math_fround(.8999999761581421);
   $411 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($603), Math_fround($601))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
   $414 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
   HEAP32[($3_1 + 60 | 0) >> 2] = $414 + 1 | 0;
   HEAP32[(($9_1 + 4 | 0) + ($414 << 2 | 0) | 0) >> 2] = $411;
   $421 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($603), Math_fround($601))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
   $424 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
   HEAP32[($3_1 + 60 | 0) >> 2] = $424 + 1 | 0;
   HEAP32[(($9_1 + 4 | 0) + ($424 << 2 | 0) | 0) >> 2] = $421;
   HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround($7($9_1 | 0, Math_fround($601), Math_fround(Math_fround(2.0))));
   $433 = ($8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($601), Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2])))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0) - 1 | 0;
   $436 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
   HEAP32[($3_1 + 60 | 0) >> 2] = $436 + 1 | 0;
   HEAP32[(($9_1 + 4 | 0) + ($436 << 2 | 0) | 0) >> 2] = $433;
   $443 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
   $446 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
   HEAP32[($3_1 + 60 | 0) >> 2] = $446 + 1 | 0;
   HEAP32[(($9_1 + 4 | 0) + ($446 << 2 | 0) | 0) >> 2] = $443;
   $455 = ($8($9_1 | 0, Math_fround(Math_fround(Math_fround($7($9_1 | 0, Math_fround($601), Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2])))) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0) - 1 | 0;
   $458 = HEAP32[($3_1 + 60 | 0) >> 2] | 0;
   HEAP32[($3_1 + 60 | 0) >> 2] = $458 + 1 | 0;
   HEAP32[(($9_1 + 4 | 0) + ($458 << 2 | 0) | 0) >> 2] = $455;
   label$59 : {
    if (!((HEAP32[($3_1 + 60 | 0) >> 2] | 0 | 0) < (14 | 0) & 1 | 0)) {
     break label$59
    }
    HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround($7($9_1 | 0, Math_fround(Math_fround(.8999999761581421)), Math_fround(Math_fround(.4000000059604645))));
    label$60 : {
     label$61 : while (1) {
      if (!((HEAP32[($3_1 + 60 | 0) >> 2] | 0 | 0) < (14 | 0) & 1 | 0)) {
       break label$60
      }
      $479 = $8($9_1 | 0, Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) * Math_fround(HEAP32[$9_1 >> 2] | 0 | 0)))) | 0;
      HEAP32[(($9_1 + ((HEAP32[($3_1 + 60 | 0) >> 2] | 0) << 2 | 0) | 0) + 4 | 0) >> 2] = $479;
      HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(+Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) + -.03);
      $632 = Math_fround($7($9_1 | 0, Math_fround(Math_fround(0 | 0)), Math_fround(Math_fround(.019999999552965164))));
      HEAPF32[($3_1 + 32 | 0) >> 2] = Math_fround(Math_fround(HEAPF32[($3_1 + 32 | 0) >> 2]) - $632);
      HEAP32[($3_1 + 60 | 0) >> 2] = (HEAP32[($3_1 + 60 | 0) >> 2] | 0) + 1 | 0;
      continue label$61;
     };
    }
   }
  }
  $489 = 0;
  HEAP32[($9_1 + 4 | 0) >> 2] = $489;
  HEAP32[($9_1 + 8 | 0) >> 2] = $489;
  label$62 : {
   $493 = $3_1 + 80 | 0;
   if ($493 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $493;
  }
  return;
 }
 
 function $5($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, $5_1 = 0, i64toi32_i32$4 = 0, i64toi32_i32$2 = 0, i64toi32_i32$3 = 0, $24$hi = 0, $25$hi = 0, $26$hi = 0, $27$hi = 0, $25_1 = 0, $28$hi = 0, $29$hi = 0, i64toi32_i32$5 = 0, $23_1 = 0, $22_1 = 0, $24_1 = 0, $70_1 = 0, $81_1 = 0, $19_1 = 0;
  $5_1 = global$0 - 16 | 0;
  label$1 : {
   $22_1 = $5_1;
   if ($5_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $22_1;
  }
  HEAP32[($5_1 + 12 | 0) >> 2] = $0_1;
  HEAP32[($5_1 + 8 | 0) >> 2] = $1_1;
  HEAP32[($5_1 + 4 | 0) >> 2] = $2_1;
  i64toi32_i32$0 = 0;
  $24_1 = $3((HEAP32[($5_1 + 12 | 0) >> 2] | 0) + 68 | 0 | 0) | 0;
  $24$hi = i64toi32_i32$0;
  i64toi32_i32$1 = ((HEAP32[($5_1 + 4 | 0) >> 2] | 0) - (HEAP32[($5_1 + 8 | 0) >> 2] | 0) | 0) + 1 | 0;
  i64toi32_i32$0 = i64toi32_i32$1 >> 31 | 0;
  $25$hi = i64toi32_i32$0;
  i64toi32_i32$0 = $24$hi;
  i64toi32_i32$0 = $25$hi;
  $70_1 = i64toi32_i32$1;
  i64toi32_i32$0 = $24$hi;
  i64toi32_i32$1 = $25$hi;
  i64toi32_i32$1 = __wasm_i64_mul($24_1 | 0, i64toi32_i32$0 | 0, $70_1 | 0, i64toi32_i32$1 | 0) | 0;
  i64toi32_i32$0 = i64toi32_i32$HIGH_BITS;
  $26$hi = i64toi32_i32$0;
  i64toi32_i32$0 = 0;
  $27$hi = i64toi32_i32$0;
  i64toi32_i32$0 = $26$hi;
  i64toi32_i32$0 = $27$hi;
  i64toi32_i32$0 = $26$hi;
  i64toi32_i32$2 = i64toi32_i32$1;
  i64toi32_i32$1 = $27$hi;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$1 = 0;
   $25_1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
  } else {
   i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
   $25_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
  }
  $28$hi = i64toi32_i32$1;
  i64toi32_i32$2 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
  i64toi32_i32$1 = i64toi32_i32$2 >> 31 | 0;
  $29$hi = i64toi32_i32$1;
  i64toi32_i32$1 = $28$hi;
  i64toi32_i32$1 = $29$hi;
  $81_1 = i64toi32_i32$2;
  i64toi32_i32$1 = $28$hi;
  i64toi32_i32$0 = $25_1;
  i64toi32_i32$2 = $29$hi;
  i64toi32_i32$3 = $81_1;
  i64toi32_i32$4 = i64toi32_i32$0 + i64toi32_i32$3 | 0;
  i64toi32_i32$5 = i64toi32_i32$1 + i64toi32_i32$2 | 0;
  if (i64toi32_i32$4 >>> 0 < i64toi32_i32$3 >>> 0) {
   i64toi32_i32$5 = i64toi32_i32$5 + 1 | 0
  }
  $19_1 = i64toi32_i32$4;
  label$3 : {
   $23_1 = $5_1 + 16 | 0;
   if ($23_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $23_1;
  }
  return $19_1 | 0;
 }
 
 function $6($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $19_1 = 0, $18_1 = 0, $15_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $18_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $18_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $15_1 = (($3((HEAP32[($3_1 + 12 | 0) >> 2] | 0) + 68 | 0 | 0) | 0) & -2147483648 | 0 | 0) != (0 | 0) & 1 | 0;
  label$3 : {
   $19_1 = $3_1 + 16 | 0;
   if ($19_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $19_1;
  }
  return $15_1 | 0;
 }
 
 function $7($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = Math_fround($1_1);
  $2_1 = Math_fround($2_1);
  var $5_1 = 0, $17_1 = 0, $16_1 = 0, $27_1 = Math_fround(0);
  $5_1 = global$0 - 32 | 0;
  label$1 : {
   $16_1 = $5_1;
   if ($5_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $16_1;
  }
  HEAP32[($5_1 + 28 | 0) >> 2] = $0_1;
  HEAPF32[($5_1 + 24 | 0) >> 2] = $1_1;
  HEAPF32[($5_1 + 20 | 0) >> 2] = $2_1;
  HEAP32[($5_1 + 16 | 0) >> 2] = ($3((HEAP32[($5_1 + 28 | 0) >> 2] | 0) + 68 | 0 | 0) | 0) >>> 9 | 0 | 1065353216 | 0;
  HEAPF32[($5_1 + 12 | 0) >> 2] = Math_fround(HEAPF32[($5_1 + 16 | 0) >> 2]);
  $27_1 = Math_fround(Math_fround(HEAPF32[($5_1 + 24 | 0) >> 2]) + Math_fround(Math_fround(Math_fround(HEAPF32[($5_1 + 12 | 0) >> 2]) - Math_fround(1.0)) * Math_fround(Math_fround(HEAPF32[($5_1 + 20 | 0) >> 2]) - Math_fround(HEAPF32[($5_1 + 24 | 0) >> 2]))));
  label$3 : {
   $17_1 = $5_1 + 32 | 0;
   if ($17_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $17_1;
  }
  return Math_fround($27_1);
 }
 
 function $8($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = Math_fround($1_1);
  var $4_1 = 0, $13_1 = Math_fround(0), $8_1 = 0;
  $4_1 = global$0 - 16 | 0;
  HEAP32[($4_1 + 12 | 0) >> 2] = $0_1;
  HEAPF32[($4_1 + 8 | 0) >> 2] = $1_1;
  $13_1 = Math_fround(Math_fround(HEAPF32[($4_1 + 8 | 0) >> 2]) + Math_fround(.9999899864196777));
  label$1 : {
   label$2 : {
    if (!(Math_fround(Math_abs($13_1)) < Math_fround(2147483648.0))) {
     break label$2
    }
    $8_1 = ~~$13_1;
    break label$1;
   }
   $8_1 = -2147483648;
  }
  return $8_1 | 0;
 }
 
 function $9($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $5_1 = 0, $27_1 = 0, $26_1 = 0;
  $5_1 = global$0 - 96 | 0;
  label$1 : {
   $26_1 = $5_1;
   if ($5_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $26_1;
  }
  HEAP32[($5_1 + 92 | 0) >> 2] = $1_1;
  HEAP32[($5_1 + 88 | 0) >> 2] = $2_1;
  HEAP32[($5_1 + 60 | 0) >> 2] = HEAP32[($5_1 + 92 | 0) >> 2] | 0;
  $2($5_1 + 68 | 0 | 0, HEAP32[($5_1 + 88 | 0) >> 2] | 0 | 0);
  $4($5_1 | 0);
  HEAP32[$0_1 >> 2] = HEAP32[$5_1 >> 2] | 0;
  HEAP32[($0_1 + 4 | 0) >> 2] = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
  HEAP32[($0_1 + 8 | 0) >> 2] = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
  HEAP32[($0_1 + 12 | 0) >> 2] = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
  HEAP32[($0_1 + 16 | 0) >> 2] = HEAP32[($5_1 + 24 | 0) >> 2] | 0;
  HEAP32[($0_1 + 20 | 0) >> 2] = HEAP32[($5_1 + 28 | 0) >> 2] | 0;
  HEAP32[($0_1 + 24 | 0) >> 2] = HEAP32[($5_1 + 32 | 0) >> 2] | 0;
  HEAP32[($0_1 + 28 | 0) >> 2] = HEAP32[($5_1 + 36 | 0) >> 2] | 0;
  HEAP32[($0_1 + 32 | 0) >> 2] = HEAP32[($5_1 + 40 | 0) >> 2] | 0;
  HEAP32[($0_1 + 36 | 0) >> 2] = HEAP32[($5_1 + 44 | 0) >> 2] | 0;
  HEAP32[($0_1 + 40 | 0) >> 2] = HEAP32[($5_1 + 48 | 0) >> 2] | 0;
  HEAP32[($0_1 + 44 | 0) >> 2] = HEAP32[($5_1 + 52 | 0) >> 2] | 0;
  HEAP32[($0_1 + 48 | 0) >> 2] = HEAP32[($5_1 + 56 | 0) >> 2] | 0;
  label$3 : {
   $27_1 = $5_1 + 96 | 0;
   if ($27_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $27_1;
  }
  return;
 }
 
 function $10() {
  FUNCTION_TABLE[1](3912) | 0;
  return;
 }
 
 function $11($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $9_1 = 0, $10_1 = 0, $8_1 = 0, $15_1 = 0, $20_1 = 0, $25_1 = 0, $30_1 = 0, $35_1 = 0, $40_1 = 0, $45_1 = 0, $50_1 = 0, $55_1 = 0, $60_1 = 0, $65_1 = 0, $70_1 = 0, $76_1 = 0, $274 = 0, $273 = 0, $80_1 = 0, $83_1 = 0, $84_1 = 0, $85_1 = 0, $86_1 = 0, $88_1 = 0, $89_1 = 0, $91_1 = 0, $92_1 = 0, $94_1 = 0, $95_1 = 0, $96_1 = 0, $101_1 = 0, $103_1 = 0, $104_1 = 0, $105_1 = 0, $106_1 = 0, $108_1 = 0, $109_1 = 0, $110_1 = 0, $111_1 = 0, $116_1 = 0, $117_1 = 0, $118_1 = 0, $119_1 = 0, $121_1 = 0, $122_1 = 0, $123_1 = 0, $124_1 = 0, $129_1 = 0, $130_1 = 0, $131_1 = 0, $132_1 = 0, $134_1 = 0, $135_1 = 0, $136_1 = 0, $137_1 = 0, $142_1 = 0, $143_1 = 0, $144_1 = 0, $145_1 = 0, $147_1 = 0, $148_1 = 0, $149_1 = 0, $150_1 = 0, $155_1 = 0, $156_1 = 0, $157_1 = 0, $158_1 = 0, $160_1 = 0, $161_1 = 0, $162_1 = 0, $163_1 = 0, $168_1 = 0, $169_1 = 0, $170_1 = 0, $171_1 = 0, $173_1 = 0, $174_1 = 0, $175_1 = 0, $176_1 = 0, $181_1 = 0, $182_1 = 0, $183_1 = 0, $184_1 = 0, $186_1 = 0, $187_1 = 0, $188_1 = 0, $189_1 = 0, $194_1 = 0, $195_1 = 0, $196_1 = 0, $197_1 = 0, $199_1 = 0, $200_1 = 0, $201_1 = 0, $202_1 = 0, $207_1 = 0, $208_1 = 0, $209_1 = 0, $210_1 = 0, $212_1 = 0, $213_1 = 0, $214_1 = 0, $215_1 = 0, $220_1 = 0, $221_1 = 0, $222_1 = 0, $223_1 = 0, $225_1 = 0, $226_1 = 0, $227_1 = 0, $228_1 = 0, $233_1 = 0, $234_1 = 0, $235_1 = 0, $236_1 = 0, $238_1 = 0, $239_1 = 0, $240_1 = 0, $241_1 = 0, $246_1 = 0, $247_1 = 0, $248_1 = 0, $249_1 = 0, $251_1 = 0, $252_1 = 0, $253_1 = 0, $254_1 = 0, $259 = 0, $260 = 0, $261 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0;
  $3_1 = global$0 - 432 | 0;
  label$1 : {
   $273 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $273;
  }
  $8_1 = $3_1 + 412 | 0;
  $9_1 = 3;
  $10_1 = 4;
  $15_1 = $3_1 + 384 | 0;
  $20_1 = $3_1 + 356 | 0;
  $25_1 = $3_1 + 328 | 0;
  $30_1 = $3_1 + 300 | 0;
  $35_1 = $3_1 + 272 | 0;
  $40_1 = $3_1 + 244 | 0;
  $45_1 = $3_1 + 216 | 0;
  $50_1 = $3_1 + 188 | 0;
  $55_1 = $3_1 + 160 | 0;
  $60_1 = $3_1 + 132 | 0;
  $65_1 = $3_1 + 104 | 0;
  $70_1 = $3_1 + 76 | 0;
  $76_1 = $3_1 + 8 | 0;
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $80_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
  HEAP32[($3_1 + 36 | 0) >> 2] = $76_1;
  HEAP32[($3_1 + 32 | 0) >> 2] = 1024;
  $17();
  HEAP32[($3_1 + 28 | 0) >> 2] = 7;
  HEAP32[($3_1 + 24 | 0) >> 2] = $18() | 0;
  HEAP32[($3_1 + 20 | 0) >> 2] = $19() | 0;
  HEAP32[($3_1 + 16 | 0) >> 2] = 6;
  $83_1 = $20() | 0;
  $84_1 = $21() | 0;
  $85_1 = $22() | 0;
  $86_1 = $23() | 0;
  HEAP32[($3_1 + 40 | 0) >> 2] = HEAP32[($3_1 + 28 | 0) >> 2] | 0;
  $88_1 = $24() | 0;
  $89_1 = HEAP32[($3_1 + 28 | 0) >> 2] | 0;
  HEAP32[($3_1 + 44 | 0) >> 2] = HEAP32[($3_1 + 24 | 0) >> 2] | 0;
  $91_1 = $25() | 0;
  $92_1 = HEAP32[($3_1 + 24 | 0) >> 2] | 0;
  HEAP32[($3_1 + 48 | 0) >> 2] = HEAP32[($3_1 + 20 | 0) >> 2] | 0;
  $94_1 = $25() | 0;
  $95_1 = HEAP32[($3_1 + 20 | 0) >> 2] | 0;
  $96_1 = HEAP32[($3_1 + 32 | 0) >> 2] | 0;
  HEAP32[($3_1 + 52 | 0) >> 2] = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
  fimport$0($83_1 | 0, $84_1 | 0, $85_1 | 0, $86_1 | 0, $88_1 | 0, $89_1 | 0, $91_1 | 0, $92_1 | 0, $94_1 | 0, $95_1 | 0, $96_1 | 0, $26() | 0 | 0, HEAP32[($3_1 + 16 | 0) >> 2] | 0 | 0);
  HEAP32[($3_1 + 56 | 0) >> 2] = $76_1;
  HEAP32[($3_1 + 64 | 0) >> 2] = HEAP32[($3_1 + 56 | 0) >> 2] | 0;
  HEAP32[($3_1 + 60 | 0) >> 2] = 5;
  $101_1 = HEAP32[($3_1 + 64 | 0) >> 2] | 0;
  $27(HEAP32[($3_1 + 60 | 0) >> 2] | 0 | 0);
  HEAP32[($3_1 + 84 | 0) >> 2] = $101_1;
  HEAP32[($3_1 + 80 | 0) >> 2] = 1037;
  HEAP32[($3_1 + 76 | 0) >> 2] = 0;
  $103_1 = HEAP32[($3_1 + 84 | 0) >> 2] | 0;
  HEAP32[($3_1 + 72 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 68 | 0) >> 2] = $9_1;
  $104_1 = $20() | 0;
  $105_1 = HEAP32[($3_1 + 80 | 0) >> 2] | 0;
  $106_1 = $28() | 0;
  HEAP32[($3_1 + 88 | 0) >> 2] = HEAP32[($3_1 + 72 | 0) >> 2] | 0;
  $108_1 = $29() | 0;
  $109_1 = HEAP32[($3_1 + 72 | 0) >> 2] | 0;
  $110_1 = $30($70_1 | 0) | 0;
  $111_1 = $28() | 0;
  HEAP32[($3_1 + 92 | 0) >> 2] = HEAP32[($3_1 + 68 | 0) >> 2] | 0;
  fimport$1($104_1 | 0, $105_1 | 0, $106_1 | 0, $108_1 | 0, $109_1 | 0, $110_1 | 0, $111_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 68 | 0) >> 2] | 0 | 0, $30($70_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 112 | 0) >> 2] = $103_1;
  HEAP32[($3_1 + 108 | 0) >> 2] = 1047;
  HEAP32[($3_1 + 104 | 0) >> 2] = 4;
  $116_1 = HEAP32[($3_1 + 112 | 0) >> 2] | 0;
  HEAP32[($3_1 + 100 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 96 | 0) >> 2] = $9_1;
  $117_1 = $20() | 0;
  $118_1 = HEAP32[($3_1 + 108 | 0) >> 2] | 0;
  $119_1 = $28() | 0;
  HEAP32[($3_1 + 116 | 0) >> 2] = HEAP32[($3_1 + 100 | 0) >> 2] | 0;
  $121_1 = $29() | 0;
  $122_1 = HEAP32[($3_1 + 100 | 0) >> 2] | 0;
  $123_1 = $30($65_1 | 0) | 0;
  $124_1 = $28() | 0;
  HEAP32[($3_1 + 120 | 0) >> 2] = HEAP32[($3_1 + 96 | 0) >> 2] | 0;
  fimport$1($117_1 | 0, $118_1 | 0, $119_1 | 0, $121_1 | 0, $122_1 | 0, $123_1 | 0, $124_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 96 | 0) >> 2] | 0 | 0, $30($65_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 140 | 0) >> 2] = $116_1;
  HEAP32[($3_1 + 136 | 0) >> 2] = 1059;
  HEAP32[($3_1 + 132 | 0) >> 2] = 8;
  $129_1 = HEAP32[($3_1 + 140 | 0) >> 2] | 0;
  HEAP32[($3_1 + 128 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 124 | 0) >> 2] = $9_1;
  $130_1 = $20() | 0;
  $131_1 = HEAP32[($3_1 + 136 | 0) >> 2] | 0;
  $132_1 = $28() | 0;
  HEAP32[($3_1 + 144 | 0) >> 2] = HEAP32[($3_1 + 128 | 0) >> 2] | 0;
  $134_1 = $29() | 0;
  $135_1 = HEAP32[($3_1 + 128 | 0) >> 2] | 0;
  $136_1 = $30($60_1 | 0) | 0;
  $137_1 = $28() | 0;
  HEAP32[($3_1 + 148 | 0) >> 2] = HEAP32[($3_1 + 124 | 0) >> 2] | 0;
  fimport$1($130_1 | 0, $131_1 | 0, $132_1 | 0, $134_1 | 0, $135_1 | 0, $136_1 | 0, $137_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 124 | 0) >> 2] | 0 | 0, $30($60_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 168 | 0) >> 2] = $129_1;
  HEAP32[($3_1 + 164 | 0) >> 2] = 1071;
  HEAP32[($3_1 + 160 | 0) >> 2] = 12;
  $142_1 = HEAP32[($3_1 + 168 | 0) >> 2] | 0;
  HEAP32[($3_1 + 156 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 152 | 0) >> 2] = $9_1;
  $143_1 = $20() | 0;
  $144_1 = HEAP32[($3_1 + 164 | 0) >> 2] | 0;
  $145_1 = $28() | 0;
  HEAP32[($3_1 + 172 | 0) >> 2] = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
  $147_1 = $29() | 0;
  $148_1 = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
  $149_1 = $30($55_1 | 0) | 0;
  $150_1 = $28() | 0;
  HEAP32[($3_1 + 176 | 0) >> 2] = HEAP32[($3_1 + 152 | 0) >> 2] | 0;
  fimport$1($143_1 | 0, $144_1 | 0, $145_1 | 0, $147_1 | 0, $148_1 | 0, $149_1 | 0, $150_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 152 | 0) >> 2] | 0 | 0, $30($55_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 196 | 0) >> 2] = $142_1;
  HEAP32[($3_1 + 192 | 0) >> 2] = 1083;
  HEAP32[($3_1 + 188 | 0) >> 2] = 16;
  $155_1 = HEAP32[($3_1 + 196 | 0) >> 2] | 0;
  HEAP32[($3_1 + 184 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 180 | 0) >> 2] = $9_1;
  $156_1 = $20() | 0;
  $157_1 = HEAP32[($3_1 + 192 | 0) >> 2] | 0;
  $158_1 = $28() | 0;
  HEAP32[($3_1 + 200 | 0) >> 2] = HEAP32[($3_1 + 184 | 0) >> 2] | 0;
  $160_1 = $29() | 0;
  $161_1 = HEAP32[($3_1 + 184 | 0) >> 2] | 0;
  $162_1 = $30($50_1 | 0) | 0;
  $163_1 = $28() | 0;
  HEAP32[($3_1 + 204 | 0) >> 2] = HEAP32[($3_1 + 180 | 0) >> 2] | 0;
  fimport$1($156_1 | 0, $157_1 | 0, $158_1 | 0, $160_1 | 0, $161_1 | 0, $162_1 | 0, $163_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 180 | 0) >> 2] | 0 | 0, $30($50_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 224 | 0) >> 2] = $155_1;
  HEAP32[($3_1 + 220 | 0) >> 2] = 1095;
  HEAP32[($3_1 + 216 | 0) >> 2] = 20;
  $168_1 = HEAP32[($3_1 + 224 | 0) >> 2] | 0;
  HEAP32[($3_1 + 212 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 208 | 0) >> 2] = $9_1;
  $169_1 = $20() | 0;
  $170_1 = HEAP32[($3_1 + 220 | 0) >> 2] | 0;
  $171_1 = $28() | 0;
  HEAP32[($3_1 + 228 | 0) >> 2] = HEAP32[($3_1 + 212 | 0) >> 2] | 0;
  $173_1 = $29() | 0;
  $174_1 = HEAP32[($3_1 + 212 | 0) >> 2] | 0;
  $175_1 = $30($45_1 | 0) | 0;
  $176_1 = $28() | 0;
  HEAP32[($3_1 + 232 | 0) >> 2] = HEAP32[($3_1 + 208 | 0) >> 2] | 0;
  fimport$1($169_1 | 0, $170_1 | 0, $171_1 | 0, $173_1 | 0, $174_1 | 0, $175_1 | 0, $176_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 208 | 0) >> 2] | 0 | 0, $30($45_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 252 | 0) >> 2] = $168_1;
  HEAP32[($3_1 + 248 | 0) >> 2] = 1107;
  HEAP32[($3_1 + 244 | 0) >> 2] = 24;
  $181_1 = HEAP32[($3_1 + 252 | 0) >> 2] | 0;
  HEAP32[($3_1 + 240 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 236 | 0) >> 2] = $9_1;
  $182_1 = $20() | 0;
  $183_1 = HEAP32[($3_1 + 248 | 0) >> 2] | 0;
  $184_1 = $28() | 0;
  HEAP32[($3_1 + 256 | 0) >> 2] = HEAP32[($3_1 + 240 | 0) >> 2] | 0;
  $186_1 = $29() | 0;
  $187_1 = HEAP32[($3_1 + 240 | 0) >> 2] | 0;
  $188_1 = $30($40_1 | 0) | 0;
  $189_1 = $28() | 0;
  HEAP32[($3_1 + 260 | 0) >> 2] = HEAP32[($3_1 + 236 | 0) >> 2] | 0;
  fimport$1($182_1 | 0, $183_1 | 0, $184_1 | 0, $186_1 | 0, $187_1 | 0, $188_1 | 0, $189_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 236 | 0) >> 2] | 0 | 0, $30($40_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 280 | 0) >> 2] = $181_1;
  HEAP32[($3_1 + 276 | 0) >> 2] = 1119;
  HEAP32[($3_1 + 272 | 0) >> 2] = 28;
  $194_1 = HEAP32[($3_1 + 280 | 0) >> 2] | 0;
  HEAP32[($3_1 + 268 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 264 | 0) >> 2] = $9_1;
  $195_1 = $20() | 0;
  $196_1 = HEAP32[($3_1 + 276 | 0) >> 2] | 0;
  $197_1 = $28() | 0;
  HEAP32[($3_1 + 284 | 0) >> 2] = HEAP32[($3_1 + 268 | 0) >> 2] | 0;
  $199_1 = $29() | 0;
  $200_1 = HEAP32[($3_1 + 268 | 0) >> 2] | 0;
  $201_1 = $30($35_1 | 0) | 0;
  $202_1 = $28() | 0;
  HEAP32[($3_1 + 288 | 0) >> 2] = HEAP32[($3_1 + 264 | 0) >> 2] | 0;
  fimport$1($195_1 | 0, $196_1 | 0, $197_1 | 0, $199_1 | 0, $200_1 | 0, $201_1 | 0, $202_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 264 | 0) >> 2] | 0 | 0, $30($35_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 308 | 0) >> 2] = $194_1;
  HEAP32[($3_1 + 304 | 0) >> 2] = 1131;
  HEAP32[($3_1 + 300 | 0) >> 2] = 32;
  $207_1 = HEAP32[($3_1 + 308 | 0) >> 2] | 0;
  HEAP32[($3_1 + 296 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 292 | 0) >> 2] = $9_1;
  $208_1 = $20() | 0;
  $209_1 = HEAP32[($3_1 + 304 | 0) >> 2] | 0;
  $210_1 = $28() | 0;
  HEAP32[($3_1 + 312 | 0) >> 2] = HEAP32[($3_1 + 296 | 0) >> 2] | 0;
  $212_1 = $29() | 0;
  $213_1 = HEAP32[($3_1 + 296 | 0) >> 2] | 0;
  $214_1 = $30($30_1 | 0) | 0;
  $215_1 = $28() | 0;
  HEAP32[($3_1 + 316 | 0) >> 2] = HEAP32[($3_1 + 292 | 0) >> 2] | 0;
  fimport$1($208_1 | 0, $209_1 | 0, $210_1 | 0, $212_1 | 0, $213_1 | 0, $214_1 | 0, $215_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 292 | 0) >> 2] | 0 | 0, $30($30_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 336 | 0) >> 2] = $207_1;
  HEAP32[($3_1 + 332 | 0) >> 2] = 1143;
  HEAP32[($3_1 + 328 | 0) >> 2] = 36;
  $220_1 = HEAP32[($3_1 + 336 | 0) >> 2] | 0;
  HEAP32[($3_1 + 324 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 320 | 0) >> 2] = $9_1;
  $221_1 = $20() | 0;
  $222_1 = HEAP32[($3_1 + 332 | 0) >> 2] | 0;
  $223_1 = $28() | 0;
  HEAP32[($3_1 + 340 | 0) >> 2] = HEAP32[($3_1 + 324 | 0) >> 2] | 0;
  $225_1 = $29() | 0;
  $226_1 = HEAP32[($3_1 + 324 | 0) >> 2] | 0;
  $227_1 = $30($25_1 | 0) | 0;
  $228_1 = $28() | 0;
  HEAP32[($3_1 + 344 | 0) >> 2] = HEAP32[($3_1 + 320 | 0) >> 2] | 0;
  fimport$1($221_1 | 0, $222_1 | 0, $223_1 | 0, $225_1 | 0, $226_1 | 0, $227_1 | 0, $228_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 320 | 0) >> 2] | 0 | 0, $30($25_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 364 | 0) >> 2] = $220_1;
  HEAP32[($3_1 + 360 | 0) >> 2] = 1155;
  HEAP32[($3_1 + 356 | 0) >> 2] = 40;
  $233_1 = HEAP32[($3_1 + 364 | 0) >> 2] | 0;
  HEAP32[($3_1 + 352 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 348 | 0) >> 2] = $9_1;
  $234_1 = $20() | 0;
  $235_1 = HEAP32[($3_1 + 360 | 0) >> 2] | 0;
  $236_1 = $28() | 0;
  HEAP32[($3_1 + 368 | 0) >> 2] = HEAP32[($3_1 + 352 | 0) >> 2] | 0;
  $238_1 = $29() | 0;
  $239_1 = HEAP32[($3_1 + 352 | 0) >> 2] | 0;
  $240_1 = $30($20_1 | 0) | 0;
  $241_1 = $28() | 0;
  HEAP32[($3_1 + 372 | 0) >> 2] = HEAP32[($3_1 + 348 | 0) >> 2] | 0;
  fimport$1($234_1 | 0, $235_1 | 0, $236_1 | 0, $238_1 | 0, $239_1 | 0, $240_1 | 0, $241_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 348 | 0) >> 2] | 0 | 0, $30($20_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 392 | 0) >> 2] = $233_1;
  HEAP32[($3_1 + 388 | 0) >> 2] = 1167;
  HEAP32[($3_1 + 384 | 0) >> 2] = 44;
  $246_1 = HEAP32[($3_1 + 392 | 0) >> 2] | 0;
  HEAP32[($3_1 + 380 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 376 | 0) >> 2] = $9_1;
  $247_1 = $20() | 0;
  $248_1 = HEAP32[($3_1 + 388 | 0) >> 2] | 0;
  $249_1 = $28() | 0;
  HEAP32[($3_1 + 396 | 0) >> 2] = HEAP32[($3_1 + 380 | 0) >> 2] | 0;
  $251_1 = $29() | 0;
  $252_1 = HEAP32[($3_1 + 380 | 0) >> 2] | 0;
  $253_1 = $30($15_1 | 0) | 0;
  $254_1 = $28() | 0;
  HEAP32[($3_1 + 400 | 0) >> 2] = HEAP32[($3_1 + 376 | 0) >> 2] | 0;
  fimport$1($247_1 | 0, $248_1 | 0, $249_1 | 0, $251_1 | 0, $252_1 | 0, $253_1 | 0, $254_1 | 0, $31() | 0 | 0, HEAP32[($3_1 + 376 | 0) >> 2] | 0 | 0, $30($15_1 | 0) | 0 | 0);
  HEAP32[($3_1 + 420 | 0) >> 2] = $246_1;
  HEAP32[($3_1 + 416 | 0) >> 2] = 1180;
  HEAP32[($3_1 + 412 | 0) >> 2] = 48;
  HEAP32[($3_1 + 408 | 0) >> 2] = $10_1;
  HEAP32[($3_1 + 404 | 0) >> 2] = $9_1;
  $259 = $20() | 0;
  $260 = HEAP32[($3_1 + 416 | 0) >> 2] | 0;
  $261 = $28() | 0;
  HEAP32[($3_1 + 424 | 0) >> 2] = HEAP32[($3_1 + 408 | 0) >> 2] | 0;
  $263 = $29() | 0;
  $264 = HEAP32[($3_1 + 408 | 0) >> 2] | 0;
  $265 = $30($8_1 | 0) | 0;
  $266 = $28() | 0;
  HEAP32[($3_1 + 428 | 0) >> 2] = HEAP32[($3_1 + 404 | 0) >> 2] | 0;
  fimport$1($259 | 0, $260 | 0, $261 | 0, $263 | 0, $264 | 0, $265 | 0, $266 | 0, $31() | 0 | 0, HEAP32[($3_1 + 404 | 0) >> 2] | 0 | 0, $30($8_1 | 0) | 0 | 0);
  $32(1193 | 0, 2 | 0);
  label$3 : {
   $274 = $3_1 + 432 | 0;
   if ($274 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $274;
  }
  return $80_1 | 0;
 }
 
 function $12($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $5_1 = 0, $15_1 = 0, $14_1 = 0, $7_1 = 0;
  $5_1 = global$0 - 16 | 0;
  label$1 : {
   $14_1 = $5_1;
   if ($5_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $14_1;
  }
  HEAP32[($5_1 + 12 | 0) >> 2] = $0_1;
  HEAP32[($5_1 + 8 | 0) >> 2] = $1_1;
  HEAP32[($5_1 + 4 | 0) >> 2] = $2_1;
  $7_1 = $47(HEAP32[($5_1 + 4 | 0) >> 2] | 0 | 0) | 0;
  HEAP32[((HEAP32[($5_1 + 8 | 0) >> 2] | 0) + (HEAP32[(HEAP32[($5_1 + 12 | 0) >> 2] | 0) >> 2] | 0) | 0) >> 2] = $7_1;
  label$3 : {
   $15_1 = $5_1 + 16 | 0;
   if ($15_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $15_1;
  }
  return;
 }
 
 function $13($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $4_1 = 0, $13_1 = 0, $12_1 = 0, $9_1 = 0;
  $4_1 = global$0 - 16 | 0;
  label$1 : {
   $12_1 = $4_1;
   if ($4_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $12_1;
  }
  HEAP32[($4_1 + 12 | 0) >> 2] = $0_1;
  HEAP32[($4_1 + 8 | 0) >> 2] = $1_1;
  $9_1 = $46((HEAP32[($4_1 + 8 | 0) >> 2] | 0) + (HEAP32[(HEAP32[($4_1 + 12 | 0) >> 2] | 0) >> 2] | 0) | 0 | 0) | 0;
  label$3 : {
   $13_1 = $4_1 + 16 | 0;
   if ($13_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $13_1;
  }
  return $9_1 | 0;
 }
 
 function $14() {
  var i64toi32_i32$1 = 0, $1_1 = 0, i64toi32_i32$0 = 0, $15_1 = 0;
  $1_1 = $54(52 | 0) | 0;
  i64toi32_i32$0 = 0;
  $15_1 = 0;
  i64toi32_i32$1 = $1_1;
  HEAP32[i64toi32_i32$1 >> 2] = $15_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  HEAP32[(i64toi32_i32$1 + 48 | 0) >> 2] = 0;
  i64toi32_i32$1 = i64toi32_i32$1 + 40 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $15_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  i64toi32_i32$1 = $1_1 + 32 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $15_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  i64toi32_i32$1 = $1_1 + 24 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $15_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  i64toi32_i32$1 = $1_1 + 16 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $15_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  i64toi32_i32$1 = $1_1 + 8 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $15_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  return $1_1 | 0;
 }
 
 function $15($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $5_1 = 0, $14_1 = 0, $13_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $13_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $13_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $5_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
  label$3 : {
   if (($5_1 | 0) == (0 | 0) & 1 | 0) {
    break label$3
   }
   $55($5_1 | 0);
  }
  label$4 : {
   $14_1 = $3_1 + 16 | 0;
   if ($14_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $14_1;
  }
  return;
 }
 
 function $16($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $9_1 = 0, $8_1 = 0, $5_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $8_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $8_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $5_1 = $37(HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0) | 0;
  label$3 : {
   $9_1 = $3_1 + 16 | 0;
   if ($9_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  return $5_1 | 0;
 }
 
 function $17() {
  return;
 }
 
 function $18() {
  return 0 | 0;
 }
 
 function $19() {
  return 0 | 0;
 }
 
 function $20() {
  return $38() | 0 | 0;
 }
 
 function $21() {
  return $39() | 0 | 0;
 }
 
 function $22() {
  return $40() | 0 | 0;
 }
 
 function $23() {
  return 0 | 0;
 }
 
 function $24() {
  return 1292 | 0;
 }
 
 function $25() {
  return 1295 | 0;
 }
 
 function $26() {
  return 1297 | 0;
 }
 
 function $27($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $6_1 = 0, $18_1 = 0, $17_1 = 0, $8_1 = 0, $9_1 = 0, $10_1 = 0;
  $3_1 = global$0 - 32 | 0;
  label$1 : {
   $17_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $17_1;
  }
  $6_1 = $3_1 + 16 | 0;
  HEAP32[($3_1 + 24 | 0) >> 2] = $0_1;
  HEAP32[($3_1 + 12 | 0) >> 2] = 8;
  $8_1 = $20() | 0;
  $9_1 = $42($6_1 | 0) | 0;
  $10_1 = $43($6_1 | 0) | 0;
  HEAP32[($3_1 + 28 | 0) >> 2] = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
  fimport$3($8_1 | 0, $9_1 | 0, $10_1 | 0, $24() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, HEAP32[($3_1 + 24 | 0) >> 2] | 0 | 0);
  label$3 : {
   $18_1 = $3_1 + 32 | 0;
   if ($18_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $18_1;
  }
  return;
 }
 
 function $28() {
  return $48() | 0 | 0;
 }
 
 function $29() {
  return 1304 | 0;
 }
 
 function $30($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $5_1 = 0, $11_1 = 0, $10_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $10_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $5_1 = $54(4 | 0) | 0;
  HEAP32[$5_1 >> 2] = HEAP32[(HEAP32[($3_1 + 12 | 0) >> 2] | 0) >> 2] | 0;
  label$3 : {
   $11_1 = $3_1 + 16 | 0;
   if ($11_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $11_1;
  }
  return $5_1 | 0;
 }
 
 function $31() {
  return 1308 | 0;
 }
 
 function $32($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $4_1 = 0, $7_1 = 0, $19_1 = 0, $18_1 = 0, $9_1 = 0, $10_1 = 0, $11_1 = 0;
  $4_1 = global$0 - 32 | 0;
  label$1 : {
   $18_1 = $4_1;
   if ($4_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $18_1;
  }
  $7_1 = $4_1 + 16 | 0;
  HEAP32[($4_1 + 24 | 0) >> 2] = $0_1;
  HEAP32[($4_1 + 20 | 0) >> 2] = $1_1;
  HEAP32[($4_1 + 12 | 0) >> 2] = 9;
  $9_1 = HEAP32[($4_1 + 24 | 0) >> 2] | 0;
  $10_1 = $34($7_1 | 0) | 0;
  $11_1 = $35($7_1 | 0) | 0;
  HEAP32[($4_1 + 28 | 0) >> 2] = HEAP32[($4_1 + 12 | 0) >> 2] | 0;
  fimport$2($9_1 | 0, $10_1 | 0, $11_1 | 0, $36() | 0 | 0, HEAP32[($4_1 + 12 | 0) >> 2] | 0 | 0, HEAP32[($4_1 + 20 | 0) >> 2] | 0 | 0);
  label$3 : {
   $19_1 = $4_1 + 32 | 0;
   if ($19_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $19_1;
  }
  return;
 }
 
 function $33($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $5_1 = 0, $16_1 = 0, $15_1 = 0, $7_1 = 0, $12_1 = 0;
  $5_1 = global$0 - 64 | 0;
  label$1 : {
   $15_1 = $5_1;
   if ($5_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $15_1;
  }
  HEAP32[($5_1 + 60 | 0) >> 2] = $0_1;
  HEAP32[($5_1 + 56 | 0) >> 2] = $1_1;
  HEAP32[($5_1 + 52 | 0) >> 2] = $2_1;
  $7_1 = HEAP32[($5_1 + 60 | 0) >> 2] | 0;
  FUNCTION_TABLE[$7_1]($5_1, $49(HEAP32[($5_1 + 56 | 0) >> 2] | 0 | 0) | 0, $49(HEAP32[($5_1 + 52 | 0) >> 2] | 0 | 0) | 0);
  $12_1 = $50($5_1 | 0) | 0;
  label$3 : {
   $16_1 = $5_1 + 64 | 0;
   if ($16_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $16_1;
  }
  return $12_1 | 0;
 }
 
 function $34($0_1) {
  $0_1 = $0_1 | 0;
  HEAP32[((global$0 - 16 | 0) + 12 | 0) >> 2] = $0_1;
  return 3 | 0;
 }
 
 function $35($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $8_1 = 0, $7_1 = 0, $4_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $7_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $7_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $4_1 = $51() | 0;
  label$3 : {
   $8_1 = $3_1 + 16 | 0;
   if ($8_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $8_1;
  }
  return $4_1 | 0;
 }
 
 function $36() {
  return 1328 | 0;
 }
 
 function $37($0_1) {
  $0_1 = $0_1 | 0;
  HEAP32[((global$0 - 16 | 0) + 12 | 0) >> 2] = $0_1;
  return 1216 | 0;
 }
 
 function $38() {
  return 1216 | 0;
 }
 
 function $39() {
  return 1240 | 0;
 }
 
 function $40() {
  return 1276 | 0;
 }
 
 function $41($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0, $6_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $6_1 = $44(FUNCTION_TABLE[HEAP32[($3_1 + 12 | 0) >> 2] | 0]() | 0 | 0) | 0;
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return $6_1 | 0;
 }
 
 function $42($0_1) {
  $0_1 = $0_1 | 0;
  HEAP32[((global$0 - 16 | 0) + 12 | 0) >> 2] = $0_1;
  return 1 | 0;
 }
 
 function $43($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $8_1 = 0, $7_1 = 0, $4_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $7_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $7_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $4_1 = $45() | 0;
  label$3 : {
   $8_1 = $3_1 + 16 | 0;
   if ($8_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $8_1;
  }
  return $4_1 | 0;
 }
 
 function $44($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0;
  $3_1 = global$0 - 16 | 0;
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  return HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0;
 }
 
 function $45() {
  return 1300 | 0;
 }
 
 function $46($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0;
  $3_1 = global$0 - 16 | 0;
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  return HEAP32[(HEAP32[($3_1 + 12 | 0) >> 2] | 0) >> 2] | 0 | 0;
 }
 
 function $47($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0;
  $3_1 = global$0 - 16 | 0;
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  return HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0;
 }
 
 function $48() {
  return 1840 | 0;
 }
 
 function $49($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0;
  $3_1 = global$0 - 16 | 0;
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  return HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0;
 }
 
 function $50($0_1) {
  $0_1 = $0_1 | 0;
  var i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, i64toi32_i32$2 = 0, $5_1 = 0, $3_1 = 0, $7_1 = 0, $8_1 = 0, $12_1 = 0, $15_1 = 0, $18_1 = 0, $21_1 = 0, $24_1 = 0, $30_1 = 0, $29_1 = 0, $57_1 = 0, $77_1 = 0, $87_1 = 0, $97_1 = 0, $107_1 = 0, $117_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $29_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $29_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $5_1 = $54(52 | 0) | 0;
  $7_1 = $52(HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0) | 0;
  i64toi32_i32$2 = $7_1;
  i64toi32_i32$0 = HEAP32[i64toi32_i32$2 >> 2] | 0;
  i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
  $57_1 = i64toi32_i32$0;
  i64toi32_i32$0 = $5_1;
  HEAP32[i64toi32_i32$0 >> 2] = $57_1;
  HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$1;
  $8_1 = 48;
  HEAP32[(i64toi32_i32$0 + $8_1 | 0) >> 2] = HEAP32[(i64toi32_i32$2 + $8_1 | 0) >> 2] | 0;
  $12_1 = 40;
  i64toi32_i32$2 = i64toi32_i32$2 + $12_1 | 0;
  i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
  i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
  $77_1 = i64toi32_i32$1;
  i64toi32_i32$1 = $5_1 + $12_1 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $77_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  $15_1 = 32;
  i64toi32_i32$2 = $7_1 + $15_1 | 0;
  i64toi32_i32$0 = HEAP32[i64toi32_i32$2 >> 2] | 0;
  i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
  $87_1 = i64toi32_i32$0;
  i64toi32_i32$0 = $5_1 + $15_1 | 0;
  HEAP32[i64toi32_i32$0 >> 2] = $87_1;
  HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$1;
  $18_1 = 24;
  i64toi32_i32$2 = $7_1 + $18_1 | 0;
  i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
  i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
  $97_1 = i64toi32_i32$1;
  i64toi32_i32$1 = $5_1 + $18_1 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $97_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  $21_1 = 16;
  i64toi32_i32$2 = $7_1 + $21_1 | 0;
  i64toi32_i32$0 = HEAP32[i64toi32_i32$2 >> 2] | 0;
  i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
  $107_1 = i64toi32_i32$0;
  i64toi32_i32$0 = $5_1 + $21_1 | 0;
  HEAP32[i64toi32_i32$0 >> 2] = $107_1;
  HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$1;
  $24_1 = 8;
  i64toi32_i32$2 = $7_1 + $24_1 | 0;
  i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
  i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
  $117_1 = i64toi32_i32$1;
  i64toi32_i32$1 = $5_1 + $24_1 | 0;
  HEAP32[i64toi32_i32$1 >> 2] = $117_1;
  HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
  label$3 : {
   $30_1 = $3_1 + 16 | 0;
   if ($30_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $30_1;
  }
  return $5_1 | 0;
 }
 
 function $51() {
  return 1316 | 0;
 }
 
 function $52($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0;
  $3_1 = global$0 - 16 | 0;
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  return HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0;
 }
 
 function $53() {
  $10();
  return;
 }
 
 function $54($0_1) {
  $0_1 = $0_1 | 0;
  var $2_1 = 0, $1_1 = 0;
  $1_1 = $0_1 ? $0_1 : 1;
  label$1 : {
   label$2 : while (1) {
    $2_1 = $227($1_1 | 0) | 0;
    if ($2_1) {
     break label$1
    }
    $0_1 = $58() | 0;
    if (!$0_1) {
     break label$1
    }
    FUNCTION_TABLE[$0_1]();
    continue label$2;
   };
  }
  return $2_1 | 0;
 }
 
 function $55($0_1) {
  $0_1 = $0_1 | 0;
  $228($0_1 | 0);
 }
 
 function $56() {
  return 3916 | 0;
 }
 
 function $57($0_1) {
  $0_1 = $0_1 | 0;
  return HEAP32[$0_1 >> 2] | 0 | 0;
 }
 
 function $58() {
  return $57(3920 | 0) | 0 | 0;
 }
 
 function $59($0_1) {
  $0_1 = $0_1 | 0;
  return $0_1 | 0;
 }
 
 function $60($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $3_1 = 0, $2_1 = 0;
  $2_1 = HEAPU8[$1_1 >> 0] | 0;
  label$1 : {
   $3_1 = HEAPU8[$0_1 >> 0] | 0;
   if (!$3_1) {
    break label$1
   }
   if (($3_1 | 0) != ($2_1 & 255 | 0 | 0)) {
    break label$1
   }
   label$2 : while (1) {
    $2_1 = HEAPU8[($1_1 + 1 | 0) >> 0] | 0;
    $3_1 = HEAPU8[($0_1 + 1 | 0) >> 0] | 0;
    if (!$3_1) {
     break label$1
    }
    $1_1 = $1_1 + 1 | 0;
    $0_1 = $0_1 + 1 | 0;
    if (($3_1 | 0) == ($2_1 & 255 | 0 | 0)) {
     continue label$2
    }
    break label$2;
   };
  }
  return $3_1 - ($2_1 & 255 | 0) | 0 | 0;
 }
 
 function $61($0_1) {
  $0_1 = $0_1 | 0;
  $59($0_1 | 0) | 0;
  return $0_1 | 0;
 }
 
 function $62($0_1) {
  $0_1 = $0_1 | 0;
 }
 
 function $63($0_1) {
  $0_1 = $0_1 | 0;
 }
 
 function $64($0_1) {
  $0_1 = $0_1 | 0;
  $61($0_1 | 0) | 0;
  $55($0_1 | 0);
 }
 
 function $65($0_1) {
  $0_1 = $0_1 | 0;
  $61($0_1 | 0) | 0;
  $55($0_1 | 0);
 }
 
 function $66($0_1) {
  $0_1 = $0_1 | 0;
  $61($0_1 | 0) | 0;
  $55($0_1 | 0);
 }
 
 function $67($0_1) {
  $0_1 = $0_1 | 0;
  $61($0_1 | 0) | 0;
  $55($0_1 | 0);
 }
 
 function $68($0_1) {
  $0_1 = $0_1 | 0;
  $61($0_1 | 0) | 0;
  $55($0_1 | 0);
 }
 
 function $69($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  return $70($0_1 | 0, $1_1 | 0, 0 | 0) | 0 | 0;
 }
 
 function $70($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  label$1 : {
   if ($2_1) {
    break label$1
   }
   return $71($0_1 | 0, $1_1 | 0) | 0 | 0;
  }
  label$2 : {
   if (($0_1 | 0) != ($1_1 | 0)) {
    break label$2
   }
   return 1 | 0;
  }
  return !($60($72($0_1 | 0) | 0 | 0, $72($1_1 | 0) | 0 | 0) | 0) | 0;
 }
 
 function $71($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  return (HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 0) == (HEAP32[($1_1 + 4 | 0) >> 2] | 0 | 0) | 0;
 }
 
 function $72($0_1) {
  $0_1 = $0_1 | 0;
  return HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 0;
 }
 
 function $73($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, $4_1 = 0, $6_1 = 0, $5_1 = 0;
  label$1 : {
   $3_1 = global$0 - 64 | 0;
   $5_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $5_1;
  }
  $4_1 = 1;
  label$3 : {
   if ($70($0_1 | 0, $1_1 | 0, 0 | 0) | 0) {
    break label$3
   }
   $4_1 = 0;
   if (!$1_1) {
    break label$3
   }
   $4_1 = 0;
   $1_1 = $74($1_1 | 0, 1392 | 0, 1440 | 0, 0 | 0) | 0;
   if (!$1_1) {
    break label$3
   }
   HEAP32[($3_1 + 20 | 0) >> 2] = -1;
   HEAP32[($3_1 + 16 | 0) >> 2] = $0_1;
   $4_1 = 0;
   HEAP32[($3_1 + 12 | 0) >> 2] = 0;
   HEAP32[($3_1 + 8 | 0) >> 2] = $1_1;
   $231($3_1 + 24 | 0 | 0, 0 | 0, 39 | 0) | 0;
   HEAP32[($3_1 + 56 | 0) >> 2] = 1;
   FUNCTION_TABLE[HEAP32[((HEAP32[$1_1 >> 2] | 0) + 28 | 0) >> 2] | 0]($1_1, $3_1 + 8 | 0, HEAP32[$2_1 >> 2] | 0, 1);
   if ((HEAP32[($3_1 + 32 | 0) >> 2] | 0 | 0) != (1 | 0)) {
    break label$3
   }
   HEAP32[$2_1 >> 2] = HEAP32[($3_1 + 24 | 0) >> 2] | 0;
   $4_1 = 1;
  }
  label$4 : {
   $6_1 = $3_1 + 64 | 0;
   if ($6_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $6_1;
  }
  return $4_1 | 0;
 }
 
 function $74($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  var $4_1 = 0, $6_1 = 0, $5_1 = 0, $8_1 = 0, $7_1 = 0, wasm2js_i32$0 = 0, wasm2js_i32$1 = 0, wasm2js_i32$2 = 0, wasm2js_i32$3 = 0, wasm2js_i32$4 = 0, wasm2js_i32$5 = 0, wasm2js_i32$6 = 0, wasm2js_i32$7 = 0, wasm2js_i32$8 = 0;
  label$1 : {
   $4_1 = global$0 - 64 | 0;
   $7_1 = $4_1;
   if ($4_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $7_1;
  }
  $5_1 = HEAP32[$0_1 >> 2] | 0;
  $6_1 = HEAP32[($5_1 + -4 | 0) >> 2] | 0;
  $5_1 = HEAP32[($5_1 + -8 | 0) >> 2] | 0;
  HEAP32[($4_1 + 20 | 0) >> 2] = $3_1;
  HEAP32[($4_1 + 16 | 0) >> 2] = $1_1;
  HEAP32[($4_1 + 12 | 0) >> 2] = $0_1;
  HEAP32[($4_1 + 8 | 0) >> 2] = $2_1;
  $1_1 = 0;
  $231($4_1 + 24 | 0 | 0, 0 | 0, 39 | 0) | 0;
  $0_1 = $0_1 + $5_1 | 0;
  label$3 : {
   label$4 : {
    if (!($70($6_1 | 0, $2_1 | 0, 0 | 0) | 0)) {
     break label$4
    }
    HEAP32[($4_1 + 56 | 0) >> 2] = 1;
    FUNCTION_TABLE[HEAP32[((HEAP32[$6_1 >> 2] | 0) + 20 | 0) >> 2] | 0]($6_1, $4_1 + 8 | 0, $0_1, $0_1, 1, 0);
    $1_1 = (HEAP32[($4_1 + 32 | 0) >> 2] | 0 | 0) == (1 | 0) ? $0_1 : 0;
    break label$3;
   }
   FUNCTION_TABLE[HEAP32[((HEAP32[$6_1 >> 2] | 0) + 24 | 0) >> 2] | 0]($6_1, $4_1 + 8 | 0, $0_1, 1, 0);
   $0_1 = HEAP32[($4_1 + 44 | 0) >> 2] | 0;
   if ($0_1 >>> 0 > 1 >>> 0) {
    break label$3
   }
   label$5 : {
    switch ($0_1 | 0) {
    default:
     $1_1 = (wasm2js_i32$0 = (wasm2js_i32$3 = (wasm2js_i32$6 = HEAP32[($4_1 + 28 | 0) >> 2] | 0, wasm2js_i32$7 = 0, wasm2js_i32$8 = (HEAP32[($4_1 + 40 | 0) >> 2] | 0 | 0) == (1 | 0), wasm2js_i32$8 ? wasm2js_i32$6 : wasm2js_i32$7), wasm2js_i32$4 = 0, wasm2js_i32$5 = (HEAP32[($4_1 + 36 | 0) >> 2] | 0 | 0) == (1 | 0), wasm2js_i32$5 ? wasm2js_i32$3 : wasm2js_i32$4), wasm2js_i32$1 = 0, wasm2js_i32$2 = (HEAP32[($4_1 + 48 | 0) >> 2] | 0 | 0) == (1 | 0), wasm2js_i32$2 ? wasm2js_i32$0 : wasm2js_i32$1);
     break label$3;
    case 1:
     break label$5;
    };
   }
   label$7 : {
    if ((HEAP32[($4_1 + 32 | 0) >> 2] | 0 | 0) == (1 | 0)) {
     break label$7
    }
    if (HEAP32[($4_1 + 48 | 0) >> 2] | 0) {
     break label$3
    }
    if ((HEAP32[($4_1 + 36 | 0) >> 2] | 0 | 0) != (1 | 0)) {
     break label$3
    }
    if ((HEAP32[($4_1 + 40 | 0) >> 2] | 0 | 0) != (1 | 0)) {
     break label$3
    }
   }
   $1_1 = HEAP32[($4_1 + 24 | 0) >> 2] | 0;
  }
  label$8 : {
   $8_1 = $4_1 + 64 | 0;
   if ($8_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $8_1;
  }
  return $1_1 | 0;
 }
 
 function $75($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  var $4_1 = 0;
  label$1 : {
   $4_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
   if ($4_1) {
    break label$1
   }
   HEAP32[($1_1 + 36 | 0) >> 2] = 1;
   HEAP32[($1_1 + 24 | 0) >> 2] = $3_1;
   HEAP32[($1_1 + 16 | 0) >> 2] = $2_1;
   return;
  }
  label$2 : {
   label$3 : {
    if (($4_1 | 0) != ($2_1 | 0)) {
     break label$3
    }
    if ((HEAP32[($1_1 + 24 | 0) >> 2] | 0 | 0) != (2 | 0)) {
     break label$2
    }
    HEAP32[($1_1 + 24 | 0) >> 2] = $3_1;
    return;
   }
   HEAP8[($1_1 + 54 | 0) >> 0] = 1;
   HEAP32[($1_1 + 24 | 0) >> 2] = 2;
   HEAP32[($1_1 + 36 | 0) >> 2] = (HEAP32[($1_1 + 36 | 0) >> 2] | 0) + 1 | 0;
  }
 }
 
 function $76($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, 0 | 0) | 0)) {
    break label$1
   }
   $75($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
  }
 }
 
 function $77($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, 0 | 0) | 0)) {
    break label$1
   }
   $75($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
   return;
  }
  $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
  FUNCTION_TABLE[HEAP32[((HEAP32[$0_1 >> 2] | 0) + 28 | 0) >> 2] | 0]($0_1, $1_1, $2_1, $3_1);
 }
 
 function $78($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  var $5_1 = 0, $4_1 = 0;
  $4_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
  label$1 : {
   label$2 : {
    if ($2_1) {
     break label$2
    }
    $5_1 = 0;
    break label$1;
   }
   $5_1 = $4_1 >> 8 | 0;
   if (!($4_1 & 1 | 0)) {
    break label$1
   }
   $5_1 = HEAP32[((HEAP32[$2_1 >> 2] | 0) + $5_1 | 0) >> 2] | 0;
  }
  $0_1 = HEAP32[$0_1 >> 2] | 0;
  FUNCTION_TABLE[HEAP32[((HEAP32[$0_1 >> 2] | 0) + 28 | 0) >> 2] | 0]($0_1, $1_1, $2_1 + $5_1 | 0, $4_1 & 2 | 0 ? $3_1 : 2);
 }
 
 function $79($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  var $4_1 = 0, $5_1 = 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, 0 | 0) | 0)) {
    break label$1
   }
   $75($0_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
   return;
  }
  $4_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
  $5_1 = $0_1 + 16 | 0;
  $78($5_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
  label$2 : {
   if (($4_1 | 0) < (2 | 0)) {
    break label$2
   }
   $4_1 = $5_1 + ($4_1 << 3 | 0) | 0;
   $0_1 = $0_1 + 24 | 0;
   label$3 : while (1) {
    $78($0_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
    if (HEAPU8[($1_1 + 54 | 0) >> 0] | 0) {
     break label$2
    }
    $0_1 = $0_1 + 8 | 0;
    if ($0_1 >>> 0 < $4_1 >>> 0) {
     continue label$3
    }
    break label$3;
   };
  }
 }
 
 function $80($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, $4_1 = 0;
  $3_1 = 1;
  label$1 : {
   label$2 : {
    if ((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 24 | 0) {
     break label$2
    }
    $3_1 = 0;
    if (!$1_1) {
     break label$1
    }
    $4_1 = $74($1_1 | 0, 1392 | 0, 1488 | 0, 0 | 0) | 0;
    if (!$4_1) {
     break label$1
    }
    $3_1 = ((HEAPU8[($4_1 + 8 | 0) >> 0] | 0) & 24 | 0 | 0) != (0 | 0);
   }
   $3_1 = $70($0_1 | 0, $1_1 | 0, $3_1 | 0) | 0;
  }
  return $3_1 | 0;
 }
 
 function $81($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $5_1 = 0, $4_1 = 0, $3_1 = 0, $6_1 = 0, $8_1 = 0, $7_1 = 0;
  label$1 : {
   $3_1 = global$0 - 64 | 0;
   $7_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $7_1;
  }
  label$3 : {
   label$4 : {
    label$5 : {
     label$6 : {
      if (!($70($1_1 | 0, 1756 | 0, 0 | 0) | 0)) {
       break label$6
      }
      HEAP32[$2_1 >> 2] = 0;
      break label$5;
     }
     label$7 : {
      if (!($80($0_1 | 0, $1_1 | 0, $1_1 | 0) | 0)) {
       break label$7
      }
      $4_1 = 1;
      $1_1 = HEAP32[$2_1 >> 2] | 0;
      if (!$1_1) {
       break label$3
      }
      HEAP32[$2_1 >> 2] = HEAP32[$1_1 >> 2] | 0;
      break label$3;
     }
     if (!$1_1) {
      break label$4
     }
     $4_1 = 0;
     $1_1 = $74($1_1 | 0, 1392 | 0, 1536 | 0, 0 | 0) | 0;
     if (!$1_1) {
      break label$3
     }
     label$8 : {
      $5_1 = HEAP32[$2_1 >> 2] | 0;
      if (!$5_1) {
       break label$8
      }
      HEAP32[$2_1 >> 2] = HEAP32[$5_1 >> 2] | 0;
     }
     $5_1 = HEAP32[($1_1 + 8 | 0) >> 2] | 0;
     $6_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
     if (($5_1 & ($6_1 ^ -1 | 0) | 0) & 7 | 0) {
      break label$3
     }
     if ((($5_1 ^ -1 | 0) & $6_1 | 0) & 96 | 0) {
      break label$3
     }
     $4_1 = 1;
     if ($70(HEAP32[($0_1 + 12 | 0) >> 2] | 0 | 0, HEAP32[($1_1 + 12 | 0) >> 2] | 0 | 0, 0 | 0) | 0) {
      break label$3
     }
     label$9 : {
      if (!($70(HEAP32[($0_1 + 12 | 0) >> 2] | 0 | 0, 1744 | 0, 0 | 0) | 0)) {
       break label$9
      }
      $1_1 = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
      if (!$1_1) {
       break label$3
      }
      $4_1 = !($74($1_1 | 0, 1392 | 0, 1588 | 0, 0 | 0) | 0);
      break label$3;
     }
     $5_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
     if (!$5_1) {
      break label$4
     }
     $4_1 = 0;
     label$10 : {
      $5_1 = $74($5_1 | 0, 1392 | 0, 1536 | 0, 0 | 0) | 0;
      if (!$5_1) {
       break label$10
      }
      if (!((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 1 | 0)) {
       break label$3
      }
      $4_1 = $82($5_1 | 0, HEAP32[($1_1 + 12 | 0) >> 2] | 0 | 0) | 0;
      break label$3;
     }
     $5_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
     if (!$5_1) {
      break label$3
     }
     $4_1 = 0;
     label$11 : {
      $5_1 = $74($5_1 | 0, 1392 | 0, 1648 | 0, 0 | 0) | 0;
      if (!$5_1) {
       break label$11
      }
      if (!((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 1 | 0)) {
       break label$3
      }
      $4_1 = $83($5_1 | 0, HEAP32[($1_1 + 12 | 0) >> 2] | 0 | 0) | 0;
      break label$3;
     }
     $0_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
     if (!$0_1) {
      break label$3
     }
     $4_1 = 0;
     $0_1 = $74($0_1 | 0, 1392 | 0, 1440 | 0, 0 | 0) | 0;
     if (!$0_1) {
      break label$3
     }
     $1_1 = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
     if (!$1_1) {
      break label$3
     }
     $4_1 = 0;
     $1_1 = $74($1_1 | 0, 1392 | 0, 1440 | 0, 0 | 0) | 0;
     if (!$1_1) {
      break label$3
     }
     HEAP32[($3_1 + 20 | 0) >> 2] = -1;
     HEAP32[($3_1 + 16 | 0) >> 2] = $0_1;
     $4_1 = 0;
     HEAP32[($3_1 + 12 | 0) >> 2] = 0;
     HEAP32[($3_1 + 8 | 0) >> 2] = $1_1;
     $231($3_1 + 24 | 0 | 0, 0 | 0, 39 | 0) | 0;
     HEAP32[($3_1 + 56 | 0) >> 2] = 1;
     FUNCTION_TABLE[HEAP32[((HEAP32[$1_1 >> 2] | 0) + 28 | 0) >> 2] | 0]($1_1, $3_1 + 8 | 0, HEAP32[$2_1 >> 2] | 0, 1);
     if ((HEAP32[($3_1 + 32 | 0) >> 2] | 0 | 0) != (1 | 0)) {
      break label$3
     }
     if (!(HEAP32[$2_1 >> 2] | 0)) {
      break label$5
     }
     HEAP32[$2_1 >> 2] = HEAP32[($3_1 + 24 | 0) >> 2] | 0;
    }
    $4_1 = 1;
    break label$3;
   }
   $4_1 = 0;
  }
  label$12 : {
   $8_1 = $3_1 + 64 | 0;
   if ($8_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $8_1;
  }
  return $4_1 | 0;
 }
 
 function $82($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $3_1 = 0, $2_1 = 0;
  label$1 : {
   label$2 : while (1) {
    label$3 : {
     if ($1_1) {
      break label$3
     }
     return 0 | 0;
    }
    $2_1 = 0;
    $1_1 = $74($1_1 | 0, 1392 | 0, 1536 | 0, 0 | 0) | 0;
    if (!$1_1) {
     break label$1
    }
    if ((HEAP32[($1_1 + 8 | 0) >> 2] | 0) & ((HEAP32[($0_1 + 8 | 0) >> 2] | 0) ^ -1 | 0) | 0) {
     break label$1
    }
    label$4 : {
     if (!($70(HEAP32[($0_1 + 12 | 0) >> 2] | 0 | 0, HEAP32[($1_1 + 12 | 0) >> 2] | 0 | 0, 0 | 0) | 0)) {
      break label$4
     }
     return 1 | 0;
    }
    if (!((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 1 | 0)) {
     break label$1
    }
    $3_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
    if (!$3_1) {
     break label$1
    }
    label$5 : {
     $3_1 = $74($3_1 | 0, 1392 | 0, 1536 | 0, 0 | 0) | 0;
     if (!$3_1) {
      break label$5
     }
     $1_1 = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
     $0_1 = $3_1;
     continue label$2;
    }
    break label$2;
   };
   $0_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
   if (!$0_1) {
    break label$1
   }
   $2_1 = 0;
   $0_1 = $74($0_1 | 0, 1392 | 0, 1648 | 0, 0 | 0) | 0;
   if (!$0_1) {
    break label$1
   }
   $2_1 = $83($0_1 | 0, HEAP32[($1_1 + 12 | 0) >> 2] | 0 | 0) | 0;
  }
  return $2_1 | 0;
 }
 
 function $83($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $2_1 = 0;
  $2_1 = 0;
  label$1 : {
   if (!$1_1) {
    break label$1
   }
   $1_1 = $74($1_1 | 0, 1392 | 0, 1648 | 0, 0 | 0) | 0;
   if (!$1_1) {
    break label$1
   }
   if ((HEAP32[($1_1 + 8 | 0) >> 2] | 0) & ((HEAP32[($0_1 + 8 | 0) >> 2] | 0) ^ -1 | 0) | 0) {
    break label$1
   }
   $2_1 = 0;
   if (!($70(HEAP32[($0_1 + 12 | 0) >> 2] | 0 | 0, HEAP32[($1_1 + 12 | 0) >> 2] | 0 | 0, 0 | 0) | 0)) {
    break label$1
   }
   $2_1 = $70(HEAP32[($0_1 + 16 | 0) >> 2] | 0 | 0, HEAP32[($1_1 + 16 | 0) >> 2] | 0 | 0, 0 | 0) | 0;
  }
  return $2_1 | 0;
 }
 
 function $84($0_1, $1_1, $2_1, $3_1, $4_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  HEAP8[($1_1 + 53 | 0) >> 0] = 1;
  label$1 : {
   if ((HEAP32[($1_1 + 4 | 0) >> 2] | 0 | 0) != ($3_1 | 0)) {
    break label$1
   }
   HEAP8[($1_1 + 52 | 0) >> 0] = 1;
   label$2 : {
    $3_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
    if ($3_1) {
     break label$2
    }
    HEAP32[($1_1 + 36 | 0) >> 2] = 1;
    HEAP32[($1_1 + 24 | 0) >> 2] = $4_1;
    HEAP32[($1_1 + 16 | 0) >> 2] = $2_1;
    if (($4_1 | 0) != (1 | 0)) {
     break label$1
    }
    if ((HEAP32[($1_1 + 48 | 0) >> 2] | 0 | 0) != (1 | 0)) {
     break label$1
    }
    HEAP8[($1_1 + 54 | 0) >> 0] = 1;
    return;
   }
   label$3 : {
    if (($3_1 | 0) != ($2_1 | 0)) {
     break label$3
    }
    label$4 : {
     $3_1 = HEAP32[($1_1 + 24 | 0) >> 2] | 0;
     if (($3_1 | 0) != (2 | 0)) {
      break label$4
     }
     HEAP32[($1_1 + 24 | 0) >> 2] = $4_1;
     $3_1 = $4_1;
    }
    if ((HEAP32[($1_1 + 48 | 0) >> 2] | 0 | 0) != (1 | 0)) {
     break label$1
    }
    if (($3_1 | 0) != (1 | 0)) {
     break label$1
    }
    HEAP8[($1_1 + 54 | 0) >> 0] = 1;
    return;
   }
   HEAP8[($1_1 + 54 | 0) >> 0] = 1;
   HEAP32[($1_1 + 36 | 0) >> 2] = (HEAP32[($1_1 + 36 | 0) >> 2] | 0) + 1 | 0;
  }
 }
 
 function $85($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  label$1 : {
   if ((HEAP32[($1_1 + 4 | 0) >> 2] | 0 | 0) != ($2_1 | 0)) {
    break label$1
   }
   if ((HEAP32[($1_1 + 28 | 0) >> 2] | 0 | 0) == (1 | 0)) {
    break label$1
   }
   HEAP32[($1_1 + 28 | 0) >> 2] = $3_1;
  }
 }
 
 function $86($0_1, $1_1, $2_1, $3_1, $4_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  var $5_1 = 0, $8_1 = 0, $6_1 = 0, $7_1 = 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, $4_1 | 0) | 0)) {
    break label$1
   }
   $85($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
   return;
  }
  label$2 : {
   label$3 : {
    if (!($70($0_1 | 0, HEAP32[$1_1 >> 2] | 0 | 0, $4_1 | 0) | 0)) {
     break label$3
    }
    label$4 : {
     label$5 : {
      if ((HEAP32[($1_1 + 16 | 0) >> 2] | 0 | 0) == ($2_1 | 0)) {
       break label$5
      }
      if ((HEAP32[($1_1 + 20 | 0) >> 2] | 0 | 0) != ($2_1 | 0)) {
       break label$4
      }
     }
     if (($3_1 | 0) != (1 | 0)) {
      break label$2
     }
     HEAP32[($1_1 + 32 | 0) >> 2] = 1;
     return;
    }
    HEAP32[($1_1 + 32 | 0) >> 2] = $3_1;
    label$6 : {
     if ((HEAP32[($1_1 + 44 | 0) >> 2] | 0 | 0) == (4 | 0)) {
      break label$6
     }
     $5_1 = $0_1 + 16 | 0;
     $3_1 = $5_1 + ((HEAP32[($0_1 + 12 | 0) >> 2] | 0) << 3 | 0) | 0;
     $6_1 = 0;
     $7_1 = 0;
     label$7 : {
      label$8 : {
       label$9 : {
        label$10 : while (1) {
         if ($5_1 >>> 0 >= $3_1 >>> 0) {
          break label$9
         }
         HEAP16[($1_1 + 52 | 0) >> 1] = 0;
         $87($5_1 | 0, $1_1 | 0, $2_1 | 0, $2_1 | 0, 1 | 0, $4_1 | 0);
         if (HEAPU8[($1_1 + 54 | 0) >> 0] | 0) {
          break label$9
         }
         label$11 : {
          if (!(HEAPU8[($1_1 + 53 | 0) >> 0] | 0)) {
           break label$11
          }
          label$12 : {
           if (!(HEAPU8[($1_1 + 52 | 0) >> 0] | 0)) {
            break label$12
           }
           $8_1 = 1;
           if ((HEAP32[($1_1 + 24 | 0) >> 2] | 0 | 0) == (1 | 0)) {
            break label$8
           }
           $6_1 = 1;
           $7_1 = 1;
           $8_1 = 1;
           if ((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 2 | 0) {
            break label$11
           }
           break label$8;
          }
          $6_1 = 1;
          $8_1 = $7_1;
          if (!((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 1 | 0)) {
           break label$8
          }
         }
         $5_1 = $5_1 + 8 | 0;
         continue label$10;
        };
       }
       $5_1 = 4;
       $8_1 = $7_1;
       if (!($6_1 & 1 | 0)) {
        break label$7
       }
      }
      $5_1 = 3;
     }
     HEAP32[($1_1 + 44 | 0) >> 2] = $5_1;
     if ($8_1 & 1 | 0) {
      break label$2
     }
    }
    HEAP32[($1_1 + 20 | 0) >> 2] = $2_1;
    HEAP32[($1_1 + 40 | 0) >> 2] = (HEAP32[($1_1 + 40 | 0) >> 2] | 0) + 1 | 0;
    if ((HEAP32[($1_1 + 36 | 0) >> 2] | 0 | 0) != (1 | 0)) {
     break label$2
    }
    if ((HEAP32[($1_1 + 24 | 0) >> 2] | 0 | 0) != (2 | 0)) {
     break label$2
    }
    HEAP8[($1_1 + 54 | 0) >> 0] = 1;
    return;
   }
   $5_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
   $8_1 = $0_1 + 16 | 0;
   $88($8_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0);
   if (($5_1 | 0) < (2 | 0)) {
    break label$2
   }
   $8_1 = $8_1 + ($5_1 << 3 | 0) | 0;
   $5_1 = $0_1 + 24 | 0;
   label$13 : {
    label$14 : {
     $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
     if ($0_1 & 2 | 0) {
      break label$14
     }
     if ((HEAP32[($1_1 + 36 | 0) >> 2] | 0 | 0) != (1 | 0)) {
      break label$13
     }
    }
    label$15 : while (1) {
     if (HEAPU8[($1_1 + 54 | 0) >> 0] | 0) {
      break label$2
     }
     $88($5_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0);
     $5_1 = $5_1 + 8 | 0;
     if ($5_1 >>> 0 < $8_1 >>> 0) {
      continue label$15
     }
     break label$2;
    };
   }
   label$16 : {
    if ($0_1 & 1 | 0) {
     break label$16
    }
    label$17 : while (1) {
     if (HEAPU8[($1_1 + 54 | 0) >> 0] | 0) {
      break label$2
     }
     if ((HEAP32[($1_1 + 36 | 0) >> 2] | 0 | 0) == (1 | 0)) {
      break label$2
     }
     $88($5_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0);
     $5_1 = $5_1 + 8 | 0;
     if ($5_1 >>> 0 < $8_1 >>> 0) {
      continue label$17
     }
     break label$2;
    };
   }
   label$18 : while (1) {
    if (HEAPU8[($1_1 + 54 | 0) >> 0] | 0) {
     break label$2
    }
    label$19 : {
     if ((HEAP32[($1_1 + 36 | 0) >> 2] | 0 | 0) != (1 | 0)) {
      break label$19
     }
     if ((HEAP32[($1_1 + 24 | 0) >> 2] | 0 | 0) == (1 | 0)) {
      break label$2
     }
    }
    $88($5_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0);
    $5_1 = $5_1 + 8 | 0;
    if ($5_1 >>> 0 < $8_1 >>> 0) {
     continue label$18
    }
    break label$18;
   };
  }
 }
 
 function $87($0_1, $1_1, $2_1, $3_1, $4_1, $5_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  var $6_1 = 0, $7_1 = 0;
  $6_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
  $7_1 = $6_1 >> 8 | 0;
  label$1 : {
   if (!($6_1 & 1 | 0)) {
    break label$1
   }
   $7_1 = HEAP32[((HEAP32[$3_1 >> 2] | 0) + $7_1 | 0) >> 2] | 0;
  }
  $0_1 = HEAP32[$0_1 >> 2] | 0;
  FUNCTION_TABLE[HEAP32[((HEAP32[$0_1 >> 2] | 0) + 20 | 0) >> 2] | 0]($0_1, $1_1, $2_1, $3_1 + $7_1 | 0, $6_1 & 2 | 0 ? $4_1 : 2, $5_1);
 }
 
 function $88($0_1, $1_1, $2_1, $3_1, $4_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  var $5_1 = 0, $6_1 = 0;
  $5_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
  $6_1 = $5_1 >> 8 | 0;
  label$1 : {
   if (!($5_1 & 1 | 0)) {
    break label$1
   }
   $6_1 = HEAP32[((HEAP32[$2_1 >> 2] | 0) + $6_1 | 0) >> 2] | 0;
  }
  $0_1 = HEAP32[$0_1 >> 2] | 0;
  FUNCTION_TABLE[HEAP32[((HEAP32[$0_1 >> 2] | 0) + 24 | 0) >> 2] | 0]($0_1, $1_1, $2_1 + $6_1 | 0, $5_1 & 2 | 0 ? $3_1 : 2, $4_1);
 }
 
 function $89($0_1, $1_1, $2_1, $3_1, $4_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, $4_1 | 0) | 0)) {
    break label$1
   }
   $85($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
   return;
  }
  label$2 : {
   label$3 : {
    if (!($70($0_1 | 0, HEAP32[$1_1 >> 2] | 0 | 0, $4_1 | 0) | 0)) {
     break label$3
    }
    label$4 : {
     label$5 : {
      if ((HEAP32[($1_1 + 16 | 0) >> 2] | 0 | 0) == ($2_1 | 0)) {
       break label$5
      }
      if ((HEAP32[($1_1 + 20 | 0) >> 2] | 0 | 0) != ($2_1 | 0)) {
       break label$4
      }
     }
     if (($3_1 | 0) != (1 | 0)) {
      break label$2
     }
     HEAP32[($1_1 + 32 | 0) >> 2] = 1;
     return;
    }
    HEAP32[($1_1 + 32 | 0) >> 2] = $3_1;
    label$6 : {
     if ((HEAP32[($1_1 + 44 | 0) >> 2] | 0 | 0) == (4 | 0)) {
      break label$6
     }
     HEAP16[($1_1 + 52 | 0) >> 1] = 0;
     $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
     FUNCTION_TABLE[HEAP32[((HEAP32[$0_1 >> 2] | 0) + 20 | 0) >> 2] | 0]($0_1, $1_1, $2_1, $2_1, 1, $4_1);
     label$7 : {
      if (!(HEAPU8[($1_1 + 53 | 0) >> 0] | 0)) {
       break label$7
      }
      HEAP32[($1_1 + 44 | 0) >> 2] = 3;
      if (!(HEAPU8[($1_1 + 52 | 0) >> 0] | 0)) {
       break label$6
      }
      break label$2;
     }
     HEAP32[($1_1 + 44 | 0) >> 2] = 4;
    }
    HEAP32[($1_1 + 20 | 0) >> 2] = $2_1;
    HEAP32[($1_1 + 40 | 0) >> 2] = (HEAP32[($1_1 + 40 | 0) >> 2] | 0) + 1 | 0;
    if ((HEAP32[($1_1 + 36 | 0) >> 2] | 0 | 0) != (1 | 0)) {
     break label$2
    }
    if ((HEAP32[($1_1 + 24 | 0) >> 2] | 0 | 0) != (2 | 0)) {
     break label$2
    }
    HEAP8[($1_1 + 54 | 0) >> 0] = 1;
    return;
   }
   $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
   FUNCTION_TABLE[HEAP32[((HEAP32[$0_1 >> 2] | 0) + 24 | 0) >> 2] | 0]($0_1, $1_1, $2_1, $3_1, $4_1);
  }
 }
 
 function $90($0_1, $1_1, $2_1, $3_1, $4_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, $4_1 | 0) | 0)) {
    break label$1
   }
   $85($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0);
   return;
  }
  label$2 : {
   if (!($70($0_1 | 0, HEAP32[$1_1 >> 2] | 0 | 0, $4_1 | 0) | 0)) {
    break label$2
   }
   label$3 : {
    label$4 : {
     if ((HEAP32[($1_1 + 16 | 0) >> 2] | 0 | 0) == ($2_1 | 0)) {
      break label$4
     }
     if ((HEAP32[($1_1 + 20 | 0) >> 2] | 0 | 0) != ($2_1 | 0)) {
      break label$3
     }
    }
    if (($3_1 | 0) != (1 | 0)) {
     break label$2
    }
    HEAP32[($1_1 + 32 | 0) >> 2] = 1;
    return;
   }
   HEAP32[($1_1 + 20 | 0) >> 2] = $2_1;
   HEAP32[($1_1 + 32 | 0) >> 2] = $3_1;
   HEAP32[($1_1 + 40 | 0) >> 2] = (HEAP32[($1_1 + 40 | 0) >> 2] | 0) + 1 | 0;
   label$5 : {
    if ((HEAP32[($1_1 + 36 | 0) >> 2] | 0 | 0) != (1 | 0)) {
     break label$5
    }
    if ((HEAP32[($1_1 + 24 | 0) >> 2] | 0 | 0) != (2 | 0)) {
     break label$5
    }
    HEAP8[($1_1 + 54 | 0) >> 0] = 1;
   }
   HEAP32[($1_1 + 44 | 0) >> 2] = 4;
  }
 }
 
 function $91($0_1, $1_1, $2_1, $3_1, $4_1, $5_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  var $7_1 = 0, $6_1 = 0, $8_1 = 0, $9_1 = 0, $10_1 = 0, $11_1 = 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, $5_1 | 0) | 0)) {
    break label$1
   }
   $84($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0);
   return;
  }
  $6_1 = HEAPU8[($1_1 + 53 | 0) >> 0] | 0;
  $7_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
  HEAP8[($1_1 + 53 | 0) >> 0] = 0;
  $8_1 = HEAPU8[($1_1 + 52 | 0) >> 0] | 0;
  HEAP8[($1_1 + 52 | 0) >> 0] = 0;
  $9_1 = $0_1 + 16 | 0;
  $87($9_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0, $5_1 | 0);
  $10_1 = HEAPU8[($1_1 + 53 | 0) >> 0] | 0;
  $6_1 = $6_1 | $10_1 | 0;
  $11_1 = HEAPU8[($1_1 + 52 | 0) >> 0] | 0;
  $8_1 = $8_1 | $11_1 | 0;
  label$2 : {
   if (($7_1 | 0) < (2 | 0)) {
    break label$2
   }
   $9_1 = $9_1 + ($7_1 << 3 | 0) | 0;
   $7_1 = $0_1 + 24 | 0;
   label$3 : while (1) {
    if (HEAPU8[($1_1 + 54 | 0) >> 0] | 0) {
     break label$2
    }
    label$4 : {
     label$5 : {
      if (!($11_1 & 255 | 0)) {
       break label$5
      }
      if ((HEAP32[($1_1 + 24 | 0) >> 2] | 0 | 0) == (1 | 0)) {
       break label$2
      }
      if ((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 2 | 0) {
       break label$4
      }
      break label$2;
     }
     if (!($10_1 & 255 | 0)) {
      break label$4
     }
     if (!((HEAPU8[($0_1 + 8 | 0) >> 0] | 0) & 1 | 0)) {
      break label$2
     }
    }
    HEAP16[($1_1 + 52 | 0) >> 1] = 0;
    $87($7_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0, $5_1 | 0);
    $10_1 = HEAPU8[($1_1 + 53 | 0) >> 0] | 0;
    $6_1 = $10_1 | $6_1 | 0;
    $11_1 = HEAPU8[($1_1 + 52 | 0) >> 0] | 0;
    $8_1 = $11_1 | $8_1 | 0;
    $7_1 = $7_1 + 8 | 0;
    if ($7_1 >>> 0 < $9_1 >>> 0) {
     continue label$3
    }
    break label$3;
   };
  }
  HEAP8[($1_1 + 53 | 0) >> 0] = ($6_1 & 255 | 0 | 0) != (0 | 0);
  HEAP8[($1_1 + 52 | 0) >> 0] = ($8_1 & 255 | 0 | 0) != (0 | 0);
 }
 
 function $92($0_1, $1_1, $2_1, $3_1, $4_1, $5_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, $5_1 | 0) | 0)) {
    break label$1
   }
   $84($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0);
   return;
  }
  $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
  FUNCTION_TABLE[HEAP32[((HEAP32[$0_1 >> 2] | 0) + 20 | 0) >> 2] | 0]($0_1, $1_1, $2_1, $3_1, $4_1, $5_1);
 }
 
 function $93($0_1, $1_1, $2_1, $3_1, $4_1, $5_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  label$1 : {
   if (!($70($0_1 | 0, HEAP32[($1_1 + 8 | 0) >> 2] | 0 | 0, $5_1 | 0) | 0)) {
    break label$1
   }
   $84($1_1 | 0, $1_1 | 0, $2_1 | 0, $3_1 | 0, $4_1 | 0);
  }
 }
 
 function $94($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $2_1 = 0;
  label$1 : {
   $1_1 = ($238($0_1 | 0) | 0) + 1 | 0;
   $2_1 = $227($1_1 | 0) | 0;
   if ($2_1) {
    break label$1
   }
   return 0 | 0;
  }
  return $230($2_1 | 0, $0_1 | 0, $1_1 | 0) | 0 | 0;
 }
 
 function $95($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0, $6_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $6_1 = $94($72(HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0) | 0 | 0) | 0;
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return $6_1 | 0;
 }
 
 function $96() {
  var $18_1 = 0;
  $18_1 = 4;
  fimport$4($97() | 0 | 0, 2160 | 0);
  fimport$5($98() | 0 | 0, 2165 | 0, 1 | 0, 1 & 1 | 0 | 0, 0 & 1 | 0 | 0);
  $99(2170 | 0);
  $100(2175 | 0);
  $101(2187 | 0);
  $102(2201 | 0);
  $103(2207 | 0);
  $104(2222 | 0);
  $105(2226 | 0);
  $106(2239 | 0);
  $107(2244 | 0);
  $108(2258 | 0);
  $109(2264 | 0);
  fimport$6($110() | 0 | 0, 2271 | 0);
  fimport$6($111() | 0 | 0, 2283 | 0);
  fimport$7($112() | 0 | 0, $18_1 | 0, 2316 | 0);
  fimport$7($113() | 0 | 0, 2 | 0, 2329 | 0);
  fimport$7($114() | 0 | 0, $18_1 | 0, 2344 | 0);
  fimport$8($115() | 0 | 0, 2359 | 0);
  $116(2375 | 0);
  $117(2405 | 0);
  $118(2442 | 0);
  $119(2481 | 0);
  $120(2512 | 0);
  $121(2552 | 0);
  $122(2581 | 0);
  $123(2619 | 0);
  $124(2649 | 0);
  $117(2688 | 0);
  $118(2720 | 0);
  $119(2753 | 0);
  $120(2786 | 0);
  $121(2820 | 0);
  $122(2853 | 0);
  $125(2887 | 0);
  $126(2918 | 0);
  return;
 }
 
 function $97() {
  return $127() | 0 | 0;
 }
 
 function $98() {
  return $128() | 0 | 0;
 }
 
 function $99($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $8_1 = 0, $12_1 = 0, $18_1 = 0, $17_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $17_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $17_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $8_1 = 24;
  $12_1 = 24;
  fimport$9($129() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 1 | 0, (($130() | 0) << $8_1 | 0) >> $8_1 | 0 | 0, (($131() | 0) << $12_1 | 0) >> $12_1 | 0 | 0);
  label$3 : {
   $18_1 = $3_1 + 16 | 0;
   if ($18_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $18_1;
  }
  return;
 }
 
 function $100($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $8_1 = 0, $12_1 = 0, $18_1 = 0, $17_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $17_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $17_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $8_1 = 24;
  $12_1 = 24;
  fimport$9($132() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 1 | 0, (($133() | 0) << $8_1 | 0) >> $8_1 | 0 | 0, (($134() | 0) << $12_1 | 0) >> $12_1 | 0 | 0);
  label$3 : {
   $18_1 = $3_1 + 16 | 0;
   if ($18_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $18_1;
  }
  return;
 }
 
 function $101($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $16_1 = 0, $15_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $15_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $15_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$9($135() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 1 | 0, ($136() | 0) & 255 | 0 | 0, ($137() | 0) & 255 | 0 | 0);
  label$3 : {
   $16_1 = $3_1 + 16 | 0;
   if ($16_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $16_1;
  }
  return;
 }
 
 function $102($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $8_1 = 0, $12_1 = 0, $18_1 = 0, $17_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $17_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $17_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $8_1 = 16;
  $12_1 = 16;
  fimport$9($138() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 2 | 0, (($139() | 0) << $8_1 | 0) >> $8_1 | 0 | 0, (($140() | 0) << $12_1 | 0) >> $12_1 | 0 | 0);
  label$3 : {
   $18_1 = $3_1 + 16 | 0;
   if ($18_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $18_1;
  }
  return;
 }
 
 function $103($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $16_1 = 0, $15_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $15_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $15_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$9($141() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 2 | 0, ($142() | 0) & 65535 | 0 | 0, ($143() | 0) & 65535 | 0 | 0);
  label$3 : {
   $16_1 = $3_1 + 16 | 0;
   if ($16_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $16_1;
  }
  return;
 }
 
 function $104($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $12_1 = 0, $11_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $11_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $11_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$9($28() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 4 | 0, $144() | 0 | 0, $145() | 0 | 0);
  label$3 : {
   $12_1 = $3_1 + 16 | 0;
   if ($12_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $12_1;
  }
  return;
 }
 
 function $105($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $12_1 = 0, $11_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $11_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $11_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$9($146() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 4 | 0, $147() | 0 | 0, $148() | 0 | 0);
  label$3 : {
   $12_1 = $3_1 + 16 | 0;
   if ($12_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $12_1;
  }
  return;
 }
 
 function $106($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $12_1 = 0, $11_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $11_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $11_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$9($149() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 4 | 0, $150() | 0 | 0, $151() | 0 | 0);
  label$3 : {
   $12_1 = $3_1 + 16 | 0;
   if ($12_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $12_1;
  }
  return;
 }
 
 function $107($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $12_1 = 0, $11_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $11_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $11_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$9($152() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 4 | 0, $153() | 0 | 0, $154() | 0 | 0);
  label$3 : {
   $12_1 = $3_1 + 16 | 0;
   if ($12_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $12_1;
  }
  return;
 }
 
 function $108($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$10($155() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 4 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $109($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$10($156() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0, 8 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $110() {
  return $157() | 0 | 0;
 }
 
 function $111() {
  return $158() | 0 | 0;
 }
 
 function $112() {
  return $159() | 0 | 0;
 }
 
 function $113() {
  return $160() | 0 | 0;
 }
 
 function $114() {
  return $161() | 0 | 0;
 }
 
 function $115() {
  return $162() | 0 | 0;
 }
 
 function $116($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($163() | 0 | 0, $164() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $117($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($165() | 0 | 0, $166() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $118($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($167() | 0 | 0, $168() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $119($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($169() | 0 | 0, $170() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $120($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($171() | 0 | 0, $172() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $121($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($173() | 0 | 0, $174() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $122($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($175() | 0 | 0, $176() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $123($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($177() | 0 | 0, $178() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $124($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($179() | 0 | 0, $180() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $125($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($181() | 0 | 0, $182() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $126($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $10_1 = 0, $9_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $9_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $9_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  fimport$11($183() | 0 | 0, $184() | 0 | 0, HEAP32[($3_1 + 12 | 0) >> 2] | 0 | 0);
  label$3 : {
   $10_1 = $3_1 + 16 | 0;
   if ($10_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $10_1;
  }
  return;
 }
 
 function $127() {
  return 1744 | 0;
 }
 
 function $128() {
  return 1768 | 0;
 }
 
 function $129() {
  return $187() | 0 | 0;
 }
 
 function $130() {
  var $1_1 = 0;
  $1_1 = 24;
  return (($188() | 0) << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $131() {
  var $1_1 = 0;
  $1_1 = 24;
  return (($189() | 0) << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $132() {
  return $190() | 0 | 0;
 }
 
 function $133() {
  var $1_1 = 0;
  $1_1 = 24;
  return (($191() | 0) << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $134() {
  var $1_1 = 0;
  $1_1 = 24;
  return (($192() | 0) << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $135() {
  return $193() | 0 | 0;
 }
 
 function $136() {
  return ($194() | 0) & 255 | 0 | 0;
 }
 
 function $137() {
  return ($195() | 0) & 255 | 0 | 0;
 }
 
 function $138() {
  return $196() | 0 | 0;
 }
 
 function $139() {
  var $1_1 = 0;
  $1_1 = 16;
  return (($197() | 0) << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $140() {
  var $1_1 = 0;
  $1_1 = 16;
  return (($198() | 0) << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $141() {
  return $199() | 0 | 0;
 }
 
 function $142() {
  return ($200() | 0) & 65535 | 0 | 0;
 }
 
 function $143() {
  return ($201() | 0) & 65535 | 0 | 0;
 }
 
 function $144() {
  return $202() | 0 | 0;
 }
 
 function $145() {
  return $203() | 0 | 0;
 }
 
 function $146() {
  return $204() | 0 | 0;
 }
 
 function $147() {
  return $205() | 0 | 0;
 }
 
 function $148() {
  return $206() | 0 | 0;
 }
 
 function $149() {
  return $207() | 0 | 0;
 }
 
 function $150() {
  return $208() | 0 | 0;
 }
 
 function $151() {
  return $209() | 0 | 0;
 }
 
 function $152() {
  return $210() | 0 | 0;
 }
 
 function $153() {
  return $211() | 0 | 0;
 }
 
 function $154() {
  return $212() | 0 | 0;
 }
 
 function $155() {
  return $213() | 0 | 0;
 }
 
 function $156() {
  return $214() | 0 | 0;
 }
 
 function $157() {
  return 3060 | 0;
 }
 
 function $158() {
  return 3148 | 0;
 }
 
 function $159() {
  return 3236 | 0;
 }
 
 function $160() {
  return 3328 | 0;
 }
 
 function $161() {
  return 3420 | 0;
 }
 
 function $162() {
  return 3464 | 0;
 }
 
 function $163() {
  return $215() | 0 | 0;
 }
 
 function $164() {
  return 0 | 0;
 }
 
 function $165() {
  return $216() | 0 | 0;
 }
 
 function $166() {
  return 0 | 0;
 }
 
 function $167() {
  return $217() | 0 | 0;
 }
 
 function $168() {
  return 1 | 0;
 }
 
 function $169() {
  return $218() | 0 | 0;
 }
 
 function $170() {
  return 2 | 0;
 }
 
 function $171() {
  return $219() | 0 | 0;
 }
 
 function $172() {
  return 3 | 0;
 }
 
 function $173() {
  return $220() | 0 | 0;
 }
 
 function $174() {
  return 4 | 0;
 }
 
 function $175() {
  return $221() | 0 | 0;
 }
 
 function $176() {
  return 5 | 0;
 }
 
 function $177() {
  return $222() | 0 | 0;
 }
 
 function $178() {
  return 4 | 0;
 }
 
 function $179() {
  return $223() | 0 | 0;
 }
 
 function $180() {
  return 5 | 0;
 }
 
 function $181() {
  return $224() | 0 | 0;
 }
 
 function $182() {
  return 6 | 0;
 }
 
 function $183() {
  return $225() | 0 | 0;
 }
 
 function $184() {
  return 7 | 0;
 }
 
 function $185() {
  FUNCTION_TABLE[30](3924) | 0;
  return;
 }
 
 function $186($0_1) {
  $0_1 = $0_1 | 0;
  var $3_1 = 0, $8_1 = 0, $7_1 = 0, $4_1 = 0;
  $3_1 = global$0 - 16 | 0;
  label$1 : {
   $7_1 = $3_1;
   if ($3_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $7_1;
  }
  HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
  $4_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
  $96();
  label$3 : {
   $8_1 = $3_1 + 16 | 0;
   if ($8_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $8_1;
  }
  return $4_1 | 0;
 }
 
 function $187() {
  return 1780 | 0;
 }
 
 function $188() {
  var $1_1 = 0;
  $1_1 = 24;
  return (128 << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $189() {
  var $1_1 = 0;
  $1_1 = 24;
  return (127 << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $190() {
  return 1804 | 0;
 }
 
 function $191() {
  var $1_1 = 0;
  $1_1 = 24;
  return (128 << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $192() {
  var $1_1 = 0;
  $1_1 = 24;
  return (127 << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $193() {
  return 1792 | 0;
 }
 
 function $194() {
  return 0 & 255 | 0 | 0;
 }
 
 function $195() {
  return 255 & 255 | 0 | 0;
 }
 
 function $196() {
  return 1816 | 0;
 }
 
 function $197() {
  var $1_1 = 0;
  $1_1 = 16;
  return (32768 << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $198() {
  var $1_1 = 0;
  $1_1 = 16;
  return (32767 << $1_1 | 0) >> $1_1 | 0 | 0;
 }
 
 function $199() {
  return 1828 | 0;
 }
 
 function $200() {
  return 0 & 65535 | 0 | 0;
 }
 
 function $201() {
  return 65535 & 65535 | 0 | 0;
 }
 
 function $202() {
  return -2147483648 | 0;
 }
 
 function $203() {
  return 2147483647 | 0;
 }
 
 function $204() {
  return 1852 | 0;
 }
 
 function $205() {
  return 0 | 0;
 }
 
 function $206() {
  return -1 | 0;
 }
 
 function $207() {
  return 1864 | 0;
 }
 
 function $208() {
  return -2147483648 | 0;
 }
 
 function $209() {
  return 2147483647 | 0;
 }
 
 function $210() {
  return 1876 | 0;
 }
 
 function $211() {
  return 0 | 0;
 }
 
 function $212() {
  return -1 | 0;
 }
 
 function $213() {
  return 1888 | 0;
 }
 
 function $214() {
  return 1900 | 0;
 }
 
 function $215() {
  return 3504 | 0;
 }
 
 function $216() {
  return 3544 | 0;
 }
 
 function $217() {
  return 3584 | 0;
 }
 
 function $218() {
  return 3624 | 0;
 }
 
 function $219() {
  return 3664 | 0;
 }
 
 function $220() {
  return 3704 | 0;
 }
 
 function $221() {
  return 3744 | 0;
 }
 
 function $222() {
  return 3784 | 0;
 }
 
 function $223() {
  return 3824 | 0;
 }
 
 function $224() {
  return 3864 | 0;
 }
 
 function $225() {
  return 3904 | 0;
 }
 
 function $226() {
  $185();
  return;
 }
 
 function $227($0_1) {
  $0_1 = $0_1 | 0;
  var $4_1 = 0, $5_1 = 0, $6_1 = 0, $8_1 = 0, $3_1 = 0, $2_1 = 0, $11_1 = 0, $7_1 = 0, i64toi32_i32$0 = 0, $9_1 = 0, i64toi32_i32$1 = 0, i64toi32_i32$2 = 0, $1_1 = 0, $10_1 = 0, $13_1 = 0, $12_1 = 0, $88_1 = 0, $101_1 = 0, $112_1 = 0, $120_1 = 0, $128_1 = 0, $222_1 = 0, $233_1 = 0, $241_1 = 0, $249_1 = 0, $284 = 0, $362 = 0, $369 = 0, $462 = 0, $473 = 0, $481 = 0, $489 = 0, $1200 = 0, $1207 = 0, $1329 = 0, $1331 = 0, $1401 = 0, $1408 = 0, $1652 = 0, $1659 = 0;
  label$1 : {
   $1_1 = global$0 - 16 | 0;
   $12_1 = $1_1;
   if ($1_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $12_1;
  }
  label$3 : {
   label$4 : {
    label$5 : {
     label$6 : {
      label$7 : {
       label$8 : {
        label$9 : {
         label$10 : {
          label$11 : {
           label$12 : {
            label$13 : {
             label$14 : {
              if ($0_1 >>> 0 > 244 >>> 0) {
               break label$14
              }
              label$15 : {
               $2_1 = HEAP32[(0 + 3928 | 0) >> 2] | 0;
               $3_1 = $0_1 >>> 0 < 11 >>> 0 ? 16 : ($0_1 + 11 | 0) & -8 | 0;
               $4_1 = $3_1 >>> 3 | 0;
               $0_1 = $2_1 >>> $4_1 | 0;
               if (!($0_1 & 3 | 0)) {
                break label$15
               }
               $3_1 = (($0_1 ^ -1 | 0) & 1 | 0) + $4_1 | 0;
               $5_1 = $3_1 << 3 | 0;
               $4_1 = HEAP32[($5_1 + 3976 | 0) >> 2] | 0;
               $0_1 = $4_1 + 8 | 0;
               label$16 : {
                label$17 : {
                 $6_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
                 $5_1 = $5_1 + 3968 | 0;
                 if (($6_1 | 0) != ($5_1 | 0)) {
                  break label$17
                 }
                 HEAP32[(0 + 3928 | 0) >> 2] = $2_1 & (__wasm_rotl_i32(-2 | 0, $3_1 | 0) | 0) | 0;
                 break label$16;
                }
                HEAP32[(0 + 3944 | 0) >> 2] | 0;
                HEAP32[($6_1 + 12 | 0) >> 2] = $5_1;
                HEAP32[($5_1 + 8 | 0) >> 2] = $6_1;
               }
               $6_1 = $3_1 << 3 | 0;
               HEAP32[($4_1 + 4 | 0) >> 2] = $6_1 | 3 | 0;
               $4_1 = $4_1 + $6_1 | 0;
               HEAP32[($4_1 + 4 | 0) >> 2] = HEAP32[($4_1 + 4 | 0) >> 2] | 0 | 1 | 0;
               break label$3;
              }
              $7_1 = HEAP32[(0 + 3936 | 0) >> 2] | 0;
              if ($3_1 >>> 0 <= $7_1 >>> 0) {
               break label$13
              }
              label$18 : {
               if (!$0_1) {
                break label$18
               }
               label$19 : {
                label$20 : {
                 $88_1 = $0_1 << $4_1 | 0;
                 $0_1 = 2 << $4_1 | 0;
                 $0_1 = $88_1 & ($0_1 | (0 - $0_1 | 0) | 0) | 0;
                 $0_1 = ($0_1 & (0 - $0_1 | 0) | 0) + -1 | 0;
                 $101_1 = $0_1;
                 $0_1 = ($0_1 >>> 12 | 0) & 16 | 0;
                 $4_1 = $101_1 >>> $0_1 | 0;
                 $6_1 = ($4_1 >>> 5 | 0) & 8 | 0;
                 $112_1 = $6_1 | $0_1 | 0;
                 $0_1 = $4_1 >>> $6_1 | 0;
                 $4_1 = ($0_1 >>> 2 | 0) & 4 | 0;
                 $120_1 = $112_1 | $4_1 | 0;
                 $0_1 = $0_1 >>> $4_1 | 0;
                 $4_1 = ($0_1 >>> 1 | 0) & 2 | 0;
                 $128_1 = $120_1 | $4_1 | 0;
                 $0_1 = $0_1 >>> $4_1 | 0;
                 $4_1 = ($0_1 >>> 1 | 0) & 1 | 0;
                 $6_1 = ($128_1 | $4_1 | 0) + ($0_1 >>> $4_1 | 0) | 0;
                 $5_1 = $6_1 << 3 | 0;
                 $4_1 = HEAP32[($5_1 + 3976 | 0) >> 2] | 0;
                 $0_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
                 $5_1 = $5_1 + 3968 | 0;
                 if (($0_1 | 0) != ($5_1 | 0)) {
                  break label$20
                 }
                 $2_1 = $2_1 & (__wasm_rotl_i32(-2 | 0, $6_1 | 0) | 0) | 0;
                 HEAP32[(0 + 3928 | 0) >> 2] = $2_1;
                 break label$19;
                }
                HEAP32[(0 + 3944 | 0) >> 2] | 0;
                HEAP32[($0_1 + 12 | 0) >> 2] = $5_1;
                HEAP32[($5_1 + 8 | 0) >> 2] = $0_1;
               }
               $0_1 = $4_1 + 8 | 0;
               HEAP32[($4_1 + 4 | 0) >> 2] = $3_1 | 3 | 0;
               $5_1 = $4_1 + $3_1 | 0;
               $8_1 = $6_1 << 3 | 0;
               $6_1 = $8_1 - $3_1 | 0;
               HEAP32[($5_1 + 4 | 0) >> 2] = $6_1 | 1 | 0;
               HEAP32[($4_1 + $8_1 | 0) >> 2] = $6_1;
               label$21 : {
                if (!$7_1) {
                 break label$21
                }
                $8_1 = $7_1 >>> 3 | 0;
                $3_1 = ($8_1 << 3 | 0) + 3968 | 0;
                $4_1 = HEAP32[(0 + 3948 | 0) >> 2] | 0;
                label$22 : {
                 label$23 : {
                  $8_1 = 1 << $8_1 | 0;
                  if ($2_1 & $8_1 | 0) {
                   break label$23
                  }
                  HEAP32[(0 + 3928 | 0) >> 2] = $2_1 | $8_1 | 0;
                  $8_1 = $3_1;
                  break label$22;
                 }
                 $8_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
                }
                HEAP32[($3_1 + 8 | 0) >> 2] = $4_1;
                HEAP32[($8_1 + 12 | 0) >> 2] = $4_1;
                HEAP32[($4_1 + 12 | 0) >> 2] = $3_1;
                HEAP32[($4_1 + 8 | 0) >> 2] = $8_1;
               }
               HEAP32[(0 + 3948 | 0) >> 2] = $5_1;
               HEAP32[(0 + 3936 | 0) >> 2] = $6_1;
               break label$3;
              }
              $9_1 = HEAP32[(0 + 3932 | 0) >> 2] | 0;
              if (!$9_1) {
               break label$13
              }
              $0_1 = ($9_1 & (0 - $9_1 | 0) | 0) + -1 | 0;
              $222_1 = $0_1;
              $0_1 = ($0_1 >>> 12 | 0) & 16 | 0;
              $4_1 = $222_1 >>> $0_1 | 0;
              $6_1 = ($4_1 >>> 5 | 0) & 8 | 0;
              $233_1 = $6_1 | $0_1 | 0;
              $0_1 = $4_1 >>> $6_1 | 0;
              $4_1 = ($0_1 >>> 2 | 0) & 4 | 0;
              $241_1 = $233_1 | $4_1 | 0;
              $0_1 = $0_1 >>> $4_1 | 0;
              $4_1 = ($0_1 >>> 1 | 0) & 2 | 0;
              $249_1 = $241_1 | $4_1 | 0;
              $0_1 = $0_1 >>> $4_1 | 0;
              $4_1 = ($0_1 >>> 1 | 0) & 1 | 0;
              $5_1 = HEAP32[(((($249_1 | $4_1 | 0) + ($0_1 >>> $4_1 | 0) | 0) << 2 | 0) + 4232 | 0) >> 2] | 0;
              $4_1 = ((HEAP32[($5_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $3_1 | 0;
              $6_1 = $5_1;
              label$24 : {
               label$25 : while (1) {
                label$26 : {
                 $0_1 = HEAP32[($6_1 + 16 | 0) >> 2] | 0;
                 if ($0_1) {
                  break label$26
                 }
                 $0_1 = HEAP32[($6_1 + 20 | 0) >> 2] | 0;
                 if (!$0_1) {
                  break label$24
                 }
                }
                $6_1 = ((HEAP32[($0_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $3_1 | 0;
                $284 = $6_1;
                $6_1 = $6_1 >>> 0 < $4_1 >>> 0;
                $4_1 = $6_1 ? $284 : $4_1;
                $5_1 = $6_1 ? $0_1 : $5_1;
                $6_1 = $0_1;
                continue label$25;
               };
              }
              $10_1 = HEAP32[($5_1 + 24 | 0) >> 2] | 0;
              label$27 : {
               $8_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
               if (($8_1 | 0) == ($5_1 | 0)) {
                break label$27
               }
               label$28 : {
                $0_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
                if ((HEAP32[(0 + 3944 | 0) >> 2] | 0) >>> 0 > $0_1 >>> 0) {
                 break label$28
                }
                HEAP32[($0_1 + 12 | 0) >> 2] | 0;
               }
               HEAP32[($0_1 + 12 | 0) >> 2] = $8_1;
               HEAP32[($8_1 + 8 | 0) >> 2] = $0_1;
               break label$4;
              }
              label$29 : {
               $6_1 = $5_1 + 20 | 0;
               $0_1 = HEAP32[$6_1 >> 2] | 0;
               if ($0_1) {
                break label$29
               }
               $0_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
               if (!$0_1) {
                break label$12
               }
               $6_1 = $5_1 + 16 | 0;
              }
              label$30 : while (1) {
               $11_1 = $6_1;
               $8_1 = $0_1;
               $6_1 = $0_1 + 20 | 0;
               $0_1 = HEAP32[$6_1 >> 2] | 0;
               if ($0_1) {
                continue label$30
               }
               $6_1 = $8_1 + 16 | 0;
               $0_1 = HEAP32[($8_1 + 16 | 0) >> 2] | 0;
               if ($0_1) {
                continue label$30
               }
               break label$30;
              };
              HEAP32[$11_1 >> 2] = 0;
              break label$4;
             }
             $3_1 = -1;
             if ($0_1 >>> 0 > -65 >>> 0) {
              break label$13
             }
             $0_1 = $0_1 + 11 | 0;
             $3_1 = $0_1 & -8 | 0;
             $7_1 = HEAP32[(0 + 3932 | 0) >> 2] | 0;
             if (!$7_1) {
              break label$13
             }
             $11_1 = 0;
             label$31 : {
              $0_1 = $0_1 >>> 8 | 0;
              if (!$0_1) {
               break label$31
              }
              $11_1 = 31;
              if ($3_1 >>> 0 > 16777215 >>> 0) {
               break label$31
              }
              $4_1 = (($0_1 + 1048320 | 0) >>> 16 | 0) & 8 | 0;
              $0_1 = $0_1 << $4_1 | 0;
              $362 = $0_1;
              $0_1 = (($0_1 + 520192 | 0) >>> 16 | 0) & 4 | 0;
              $6_1 = $362 << $0_1 | 0;
              $369 = $6_1;
              $6_1 = (($6_1 + 245760 | 0) >>> 16 | 0) & 2 | 0;
              $0_1 = (($369 << $6_1 | 0) >>> 15 | 0) - ($0_1 | $4_1 | 0 | $6_1 | 0) | 0;
              $11_1 = ($0_1 << 1 | 0 | (($3_1 >>> ($0_1 + 21 | 0) | 0) & 1 | 0) | 0) + 28 | 0;
             }
             $6_1 = 0 - $3_1 | 0;
             label$32 : {
              label$33 : {
               label$34 : {
                label$35 : {
                 $4_1 = HEAP32[(($11_1 << 2 | 0) + 4232 | 0) >> 2] | 0;
                 if ($4_1) {
                  break label$35
                 }
                 $0_1 = 0;
                 $8_1 = 0;
                 break label$34;
                }
                $5_1 = $3_1 << (($11_1 | 0) == (31 | 0) ? 0 : 25 - ($11_1 >>> 1 | 0) | 0) | 0;
                $0_1 = 0;
                $8_1 = 0;
                label$36 : while (1) {
                 label$37 : {
                  $2_1 = ((HEAP32[($4_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $3_1 | 0;
                  if ($2_1 >>> 0 >= $6_1 >>> 0) {
                   break label$37
                  }
                  $6_1 = $2_1;
                  $8_1 = $4_1;
                  if ($6_1) {
                   break label$37
                  }
                  $6_1 = 0;
                  $8_1 = $4_1;
                  $0_1 = $4_1;
                  break label$33;
                 }
                 $2_1 = HEAP32[($4_1 + 20 | 0) >> 2] | 0;
                 $4_1 = HEAP32[(($4_1 + (($5_1 >>> 29 | 0) & 4 | 0) | 0) + 16 | 0) >> 2] | 0;
                 $0_1 = $2_1 ? (($2_1 | 0) == ($4_1 | 0) ? $0_1 : $2_1) : $0_1;
                 $5_1 = $5_1 << (($4_1 | 0) != (0 | 0)) | 0;
                 if ($4_1) {
                  continue label$36
                 }
                 break label$36;
                };
               }
               label$38 : {
                if ($0_1 | $8_1 | 0) {
                 break label$38
                }
                $0_1 = 2 << $11_1 | 0;
                $0_1 = ($0_1 | (0 - $0_1 | 0) | 0) & $7_1 | 0;
                if (!$0_1) {
                 break label$13
                }
                $0_1 = ($0_1 & (0 - $0_1 | 0) | 0) + -1 | 0;
                $462 = $0_1;
                $0_1 = ($0_1 >>> 12 | 0) & 16 | 0;
                $4_1 = $462 >>> $0_1 | 0;
                $5_1 = ($4_1 >>> 5 | 0) & 8 | 0;
                $473 = $5_1 | $0_1 | 0;
                $0_1 = $4_1 >>> $5_1 | 0;
                $4_1 = ($0_1 >>> 2 | 0) & 4 | 0;
                $481 = $473 | $4_1 | 0;
                $0_1 = $0_1 >>> $4_1 | 0;
                $4_1 = ($0_1 >>> 1 | 0) & 2 | 0;
                $489 = $481 | $4_1 | 0;
                $0_1 = $0_1 >>> $4_1 | 0;
                $4_1 = ($0_1 >>> 1 | 0) & 1 | 0;
                $0_1 = HEAP32[(((($489 | $4_1 | 0) + ($0_1 >>> $4_1 | 0) | 0) << 2 | 0) + 4232 | 0) >> 2] | 0;
               }
               if (!$0_1) {
                break label$32
               }
              }
              label$39 : while (1) {
               $2_1 = ((HEAP32[($0_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $3_1 | 0;
               $5_1 = $2_1 >>> 0 < $6_1 >>> 0;
               label$40 : {
                $4_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
                if ($4_1) {
                 break label$40
                }
                $4_1 = HEAP32[($0_1 + 20 | 0) >> 2] | 0;
               }
               $6_1 = $5_1 ? $2_1 : $6_1;
               $8_1 = $5_1 ? $0_1 : $8_1;
               $0_1 = $4_1;
               if ($0_1) {
                continue label$39
               }
               break label$39;
              };
             }
             if (!$8_1) {
              break label$13
             }
             if ($6_1 >>> 0 >= ((HEAP32[(0 + 3936 | 0) >> 2] | 0) - $3_1 | 0) >>> 0) {
              break label$13
             }
             $11_1 = HEAP32[($8_1 + 24 | 0) >> 2] | 0;
             label$41 : {
              $5_1 = HEAP32[($8_1 + 12 | 0) >> 2] | 0;
              if (($5_1 | 0) == ($8_1 | 0)) {
               break label$41
              }
              label$42 : {
               $0_1 = HEAP32[($8_1 + 8 | 0) >> 2] | 0;
               if ((HEAP32[(0 + 3944 | 0) >> 2] | 0) >>> 0 > $0_1 >>> 0) {
                break label$42
               }
               HEAP32[($0_1 + 12 | 0) >> 2] | 0;
              }
              HEAP32[($0_1 + 12 | 0) >> 2] = $5_1;
              HEAP32[($5_1 + 8 | 0) >> 2] = $0_1;
              break label$5;
             }
             label$43 : {
              $4_1 = $8_1 + 20 | 0;
              $0_1 = HEAP32[$4_1 >> 2] | 0;
              if ($0_1) {
               break label$43
              }
              $0_1 = HEAP32[($8_1 + 16 | 0) >> 2] | 0;
              if (!$0_1) {
               break label$11
              }
              $4_1 = $8_1 + 16 | 0;
             }
             label$44 : while (1) {
              $2_1 = $4_1;
              $5_1 = $0_1;
              $4_1 = $0_1 + 20 | 0;
              $0_1 = HEAP32[$4_1 >> 2] | 0;
              if ($0_1) {
               continue label$44
              }
              $4_1 = $5_1 + 16 | 0;
              $0_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
              if ($0_1) {
               continue label$44
              }
              break label$44;
             };
             HEAP32[$2_1 >> 2] = 0;
             break label$5;
            }
            label$45 : {
             $0_1 = HEAP32[(0 + 3936 | 0) >> 2] | 0;
             if ($0_1 >>> 0 < $3_1 >>> 0) {
              break label$45
             }
             $4_1 = HEAP32[(0 + 3948 | 0) >> 2] | 0;
             label$46 : {
              label$47 : {
               $6_1 = $0_1 - $3_1 | 0;
               if ($6_1 >>> 0 < 16 >>> 0) {
                break label$47
               }
               HEAP32[(0 + 3936 | 0) >> 2] = $6_1;
               $5_1 = $4_1 + $3_1 | 0;
               HEAP32[(0 + 3948 | 0) >> 2] = $5_1;
               HEAP32[($5_1 + 4 | 0) >> 2] = $6_1 | 1 | 0;
               HEAP32[($4_1 + $0_1 | 0) >> 2] = $6_1;
               HEAP32[($4_1 + 4 | 0) >> 2] = $3_1 | 3 | 0;
               break label$46;
              }
              HEAP32[(0 + 3948 | 0) >> 2] = 0;
              HEAP32[(0 + 3936 | 0) >> 2] = 0;
              HEAP32[($4_1 + 4 | 0) >> 2] = $0_1 | 3 | 0;
              $0_1 = $4_1 + $0_1 | 0;
              HEAP32[($0_1 + 4 | 0) >> 2] = HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 1 | 0;
             }
             $0_1 = $4_1 + 8 | 0;
             break label$3;
            }
            label$48 : {
             $5_1 = HEAP32[(0 + 3940 | 0) >> 2] | 0;
             if ($5_1 >>> 0 <= $3_1 >>> 0) {
              break label$48
             }
             $4_1 = $5_1 - $3_1 | 0;
             HEAP32[(0 + 3940 | 0) >> 2] = $4_1;
             $0_1 = HEAP32[(0 + 3952 | 0) >> 2] | 0;
             $6_1 = $0_1 + $3_1 | 0;
             HEAP32[(0 + 3952 | 0) >> 2] = $6_1;
             HEAP32[($6_1 + 4 | 0) >> 2] = $4_1 | 1 | 0;
             HEAP32[($0_1 + 4 | 0) >> 2] = $3_1 | 3 | 0;
             $0_1 = $0_1 + 8 | 0;
             break label$3;
            }
            label$49 : {
             label$50 : {
              if (!(HEAP32[(0 + 4400 | 0) >> 2] | 0)) {
               break label$50
              }
              $4_1 = HEAP32[(0 + 4408 | 0) >> 2] | 0;
              break label$49;
             }
             i64toi32_i32$1 = 0;
             i64toi32_i32$0 = -1;
             HEAP32[(i64toi32_i32$1 + 4412 | 0) >> 2] = -1;
             HEAP32[(i64toi32_i32$1 + 4416 | 0) >> 2] = i64toi32_i32$0;
             i64toi32_i32$1 = 0;
             i64toi32_i32$0 = 4096;
             HEAP32[(i64toi32_i32$1 + 4404 | 0) >> 2] = 4096;
             HEAP32[(i64toi32_i32$1 + 4408 | 0) >> 2] = i64toi32_i32$0;
             HEAP32[(0 + 4400 | 0) >> 2] = (($1_1 + 12 | 0) & -16 | 0) ^ 1431655768 | 0;
             HEAP32[(0 + 4420 | 0) >> 2] = 0;
             HEAP32[(0 + 4372 | 0) >> 2] = 0;
             $4_1 = 4096;
            }
            $0_1 = 0;
            $7_1 = $3_1 + 47 | 0;
            $2_1 = $4_1 + $7_1 | 0;
            $11_1 = 0 - $4_1 | 0;
            $8_1 = $2_1 & $11_1 | 0;
            if ($8_1 >>> 0 <= $3_1 >>> 0) {
             break label$3
            }
            $0_1 = 0;
            label$51 : {
             $4_1 = HEAP32[(0 + 4368 | 0) >> 2] | 0;
             if (!$4_1) {
              break label$51
             }
             $6_1 = HEAP32[(0 + 4360 | 0) >> 2] | 0;
             $9_1 = $6_1 + $8_1 | 0;
             if ($9_1 >>> 0 <= $6_1 >>> 0) {
              break label$3
             }
             if ($9_1 >>> 0 > $4_1 >>> 0) {
              break label$3
             }
            }
            if ((HEAPU8[(0 + 4372 | 0) >> 0] | 0) & 4 | 0) {
             break label$8
            }
            label$52 : {
             label$53 : {
              label$54 : {
               $4_1 = HEAP32[(0 + 3952 | 0) >> 2] | 0;
               if (!$4_1) {
                break label$54
               }
               $0_1 = 4376;
               label$55 : while (1) {
                label$56 : {
                 $6_1 = HEAP32[$0_1 >> 2] | 0;
                 if ($6_1 >>> 0 > $4_1 >>> 0) {
                  break label$56
                 }
                 if (($6_1 + (HEAP32[($0_1 + 4 | 0) >> 2] | 0) | 0) >>> 0 > $4_1 >>> 0) {
                  break label$53
                 }
                }
                $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
                if ($0_1) {
                 continue label$55
                }
                break label$55;
               };
              }
              $5_1 = $229(0 | 0) | 0;
              if (($5_1 | 0) == (-1 | 0)) {
               break label$9
              }
              $2_1 = $8_1;
              label$57 : {
               $0_1 = HEAP32[(0 + 4404 | 0) >> 2] | 0;
               $4_1 = $0_1 + -1 | 0;
               if (!($4_1 & $5_1 | 0)) {
                break label$57
               }
               $2_1 = ($8_1 - $5_1 | 0) + (($4_1 + $5_1 | 0) & (0 - $0_1 | 0) | 0) | 0;
              }
              if ($2_1 >>> 0 <= $3_1 >>> 0) {
               break label$9
              }
              if ($2_1 >>> 0 > 2147483646 >>> 0) {
               break label$9
              }
              label$58 : {
               $0_1 = HEAP32[(0 + 4368 | 0) >> 2] | 0;
               if (!$0_1) {
                break label$58
               }
               $4_1 = HEAP32[(0 + 4360 | 0) >> 2] | 0;
               $6_1 = $4_1 + $2_1 | 0;
               if ($6_1 >>> 0 <= $4_1 >>> 0) {
                break label$9
               }
               if ($6_1 >>> 0 > $0_1 >>> 0) {
                break label$9
               }
              }
              $0_1 = $229($2_1 | 0) | 0;
              if (($0_1 | 0) != ($5_1 | 0)) {
               break label$52
              }
              break label$7;
             }
             $2_1 = ($2_1 - $5_1 | 0) & $11_1 | 0;
             if ($2_1 >>> 0 > 2147483646 >>> 0) {
              break label$9
             }
             $5_1 = $229($2_1 | 0) | 0;
             if (($5_1 | 0) == ((HEAP32[$0_1 >> 2] | 0) + (HEAP32[($0_1 + 4 | 0) >> 2] | 0) | 0 | 0)) {
              break label$10
             }
             $0_1 = $5_1;
            }
            label$59 : {
             if (($3_1 + 48 | 0) >>> 0 <= $2_1 >>> 0) {
              break label$59
             }
             if (($0_1 | 0) == (-1 | 0)) {
              break label$59
             }
             label$60 : {
              $4_1 = HEAP32[(0 + 4408 | 0) >> 2] | 0;
              $4_1 = (($7_1 - $2_1 | 0) + $4_1 | 0) & (0 - $4_1 | 0) | 0;
              if ($4_1 >>> 0 <= 2147483646 >>> 0) {
               break label$60
              }
              $5_1 = $0_1;
              break label$7;
             }
             label$61 : {
              if (($229($4_1 | 0) | 0 | 0) == (-1 | 0)) {
               break label$61
              }
              $2_1 = $4_1 + $2_1 | 0;
              $5_1 = $0_1;
              break label$7;
             }
             $229(0 - $2_1 | 0 | 0) | 0;
             break label$9;
            }
            $5_1 = $0_1;
            if (($0_1 | 0) != (-1 | 0)) {
             break label$7
            }
            break label$9;
           }
           $8_1 = 0;
           break label$4;
          }
          $5_1 = 0;
          break label$5;
         }
         if (($5_1 | 0) != (-1 | 0)) {
          break label$7
         }
        }
        HEAP32[(0 + 4372 | 0) >> 2] = HEAP32[(0 + 4372 | 0) >> 2] | 0 | 4 | 0;
       }
       if ($8_1 >>> 0 > 2147483646 >>> 0) {
        break label$6
       }
       $5_1 = $229($8_1 | 0) | 0;
       $0_1 = $229(0 | 0) | 0;
       if ($5_1 >>> 0 >= $0_1 >>> 0) {
        break label$6
       }
       if (($5_1 | 0) == (-1 | 0)) {
        break label$6
       }
       if (($0_1 | 0) == (-1 | 0)) {
        break label$6
       }
       $2_1 = $0_1 - $5_1 | 0;
       if ($2_1 >>> 0 <= ($3_1 + 40 | 0) >>> 0) {
        break label$6
       }
      }
      $0_1 = (HEAP32[(0 + 4360 | 0) >> 2] | 0) + $2_1 | 0;
      HEAP32[(0 + 4360 | 0) >> 2] = $0_1;
      label$62 : {
       if ($0_1 >>> 0 <= (HEAP32[(0 + 4364 | 0) >> 2] | 0) >>> 0) {
        break label$62
       }
       HEAP32[(0 + 4364 | 0) >> 2] = $0_1;
      }
      label$63 : {
       label$64 : {
        label$65 : {
         label$66 : {
          $4_1 = HEAP32[(0 + 3952 | 0) >> 2] | 0;
          if (!$4_1) {
           break label$66
          }
          $0_1 = 4376;
          label$67 : while (1) {
           $6_1 = HEAP32[$0_1 >> 2] | 0;
           $8_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
           if (($5_1 | 0) == ($6_1 + $8_1 | 0 | 0)) {
            break label$65
           }
           $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
           if ($0_1) {
            continue label$67
           }
           break label$64;
          };
         }
         label$68 : {
          label$69 : {
           $0_1 = HEAP32[(0 + 3944 | 0) >> 2] | 0;
           if (!$0_1) {
            break label$69
           }
           if ($5_1 >>> 0 >= $0_1 >>> 0) {
            break label$68
           }
          }
          HEAP32[(0 + 3944 | 0) >> 2] = $5_1;
         }
         $0_1 = 0;
         HEAP32[(0 + 4380 | 0) >> 2] = $2_1;
         HEAP32[(0 + 4376 | 0) >> 2] = $5_1;
         HEAP32[(0 + 3960 | 0) >> 2] = -1;
         HEAP32[(0 + 3964 | 0) >> 2] = HEAP32[(0 + 4400 | 0) >> 2] | 0;
         HEAP32[(0 + 4388 | 0) >> 2] = 0;
         label$70 : while (1) {
          $4_1 = $0_1 << 3 | 0;
          $6_1 = $4_1 + 3968 | 0;
          HEAP32[($4_1 + 3976 | 0) >> 2] = $6_1;
          HEAP32[($4_1 + 3980 | 0) >> 2] = $6_1;
          $0_1 = $0_1 + 1 | 0;
          if (($0_1 | 0) != (32 | 0)) {
           continue label$70
          }
          break label$70;
         };
         $0_1 = $2_1 + -40 | 0;
         $4_1 = ($5_1 + 8 | 0) & 7 | 0 ? (-8 - $5_1 | 0) & 7 | 0 : 0;
         $6_1 = $0_1 - $4_1 | 0;
         HEAP32[(0 + 3940 | 0) >> 2] = $6_1;
         $4_1 = $5_1 + $4_1 | 0;
         HEAP32[(0 + 3952 | 0) >> 2] = $4_1;
         HEAP32[($4_1 + 4 | 0) >> 2] = $6_1 | 1 | 0;
         HEAP32[(($5_1 + $0_1 | 0) + 4 | 0) >> 2] = 40;
         HEAP32[(0 + 3956 | 0) >> 2] = HEAP32[(0 + 4416 | 0) >> 2] | 0;
         break label$63;
        }
        if ((HEAPU8[($0_1 + 12 | 0) >> 0] | 0) & 8 | 0) {
         break label$64
        }
        if ($5_1 >>> 0 <= $4_1 >>> 0) {
         break label$64
        }
        if ($6_1 >>> 0 > $4_1 >>> 0) {
         break label$64
        }
        HEAP32[($0_1 + 4 | 0) >> 2] = $8_1 + $2_1 | 0;
        $0_1 = ($4_1 + 8 | 0) & 7 | 0 ? (-8 - $4_1 | 0) & 7 | 0 : 0;
        $6_1 = $4_1 + $0_1 | 0;
        HEAP32[(0 + 3952 | 0) >> 2] = $6_1;
        $5_1 = (HEAP32[(0 + 3940 | 0) >> 2] | 0) + $2_1 | 0;
        $0_1 = $5_1 - $0_1 | 0;
        HEAP32[(0 + 3940 | 0) >> 2] = $0_1;
        HEAP32[($6_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
        HEAP32[(($4_1 + $5_1 | 0) + 4 | 0) >> 2] = 40;
        HEAP32[(0 + 3956 | 0) >> 2] = HEAP32[(0 + 4416 | 0) >> 2] | 0;
        break label$63;
       }
       label$71 : {
        $8_1 = HEAP32[(0 + 3944 | 0) >> 2] | 0;
        if ($5_1 >>> 0 >= $8_1 >>> 0) {
         break label$71
        }
        HEAP32[(0 + 3944 | 0) >> 2] = $5_1;
        $8_1 = $5_1;
       }
       $6_1 = $5_1 + $2_1 | 0;
       $0_1 = 4376;
       label$72 : {
        label$73 : {
         label$74 : {
          label$75 : {
           label$76 : {
            label$77 : {
             label$78 : {
              label$79 : while (1) {
               if ((HEAP32[$0_1 >> 2] | 0 | 0) == ($6_1 | 0)) {
                break label$78
               }
               $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
               if ($0_1) {
                continue label$79
               }
               break label$77;
              };
             }
             if (!((HEAPU8[($0_1 + 12 | 0) >> 0] | 0) & 8 | 0)) {
              break label$76
             }
            }
            $0_1 = 4376;
            label$80 : while (1) {
             label$81 : {
              $6_1 = HEAP32[$0_1 >> 2] | 0;
              if ($6_1 >>> 0 > $4_1 >>> 0) {
               break label$81
              }
              $6_1 = $6_1 + (HEAP32[($0_1 + 4 | 0) >> 2] | 0) | 0;
              if ($6_1 >>> 0 > $4_1 >>> 0) {
               break label$75
              }
             }
             $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
             continue label$80;
            };
           }
           HEAP32[$0_1 >> 2] = $5_1;
           HEAP32[($0_1 + 4 | 0) >> 2] = (HEAP32[($0_1 + 4 | 0) >> 2] | 0) + $2_1 | 0;
           $11_1 = $5_1 + (($5_1 + 8 | 0) & 7 | 0 ? (-8 - $5_1 | 0) & 7 | 0 : 0) | 0;
           HEAP32[($11_1 + 4 | 0) >> 2] = $3_1 | 3 | 0;
           $5_1 = $6_1 + (($6_1 + 8 | 0) & 7 | 0 ? (-8 - $6_1 | 0) & 7 | 0 : 0) | 0;
           $0_1 = ($5_1 - $11_1 | 0) - $3_1 | 0;
           $6_1 = $11_1 + $3_1 | 0;
           label$82 : {
            if (($4_1 | 0) != ($5_1 | 0)) {
             break label$82
            }
            HEAP32[(0 + 3952 | 0) >> 2] = $6_1;
            $0_1 = (HEAP32[(0 + 3940 | 0) >> 2] | 0) + $0_1 | 0;
            HEAP32[(0 + 3940 | 0) >> 2] = $0_1;
            HEAP32[($6_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
            break label$73;
           }
           label$83 : {
            if ((HEAP32[(0 + 3948 | 0) >> 2] | 0 | 0) != ($5_1 | 0)) {
             break label$83
            }
            HEAP32[(0 + 3948 | 0) >> 2] = $6_1;
            $0_1 = (HEAP32[(0 + 3936 | 0) >> 2] | 0) + $0_1 | 0;
            HEAP32[(0 + 3936 | 0) >> 2] = $0_1;
            HEAP32[($6_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
            HEAP32[($6_1 + $0_1 | 0) >> 2] = $0_1;
            break label$73;
           }
           label$84 : {
            $4_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
            if (($4_1 & 3 | 0 | 0) != (1 | 0)) {
             break label$84
            }
            $7_1 = $4_1 & -8 | 0;
            label$85 : {
             label$86 : {
              if ($4_1 >>> 0 > 255 >>> 0) {
               break label$86
              }
              $3_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
              label$87 : {
               $2_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
               $9_1 = $4_1 >>> 3 | 0;
               $4_1 = ($9_1 << 3 | 0) + 3968 | 0;
               if (($2_1 | 0) == ($4_1 | 0)) {
                break label$87
               }
              }
              label$88 : {
               if (($3_1 | 0) != ($2_1 | 0)) {
                break label$88
               }
               HEAP32[(0 + 3928 | 0) >> 2] = (HEAP32[(0 + 3928 | 0) >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $9_1 | 0) | 0) | 0;
               break label$85;
              }
              label$89 : {
               if (($3_1 | 0) == ($4_1 | 0)) {
                break label$89
               }
              }
              HEAP32[($2_1 + 12 | 0) >> 2] = $3_1;
              HEAP32[($3_1 + 8 | 0) >> 2] = $2_1;
              break label$85;
             }
             $9_1 = HEAP32[($5_1 + 24 | 0) >> 2] | 0;
             label$90 : {
              label$91 : {
               $2_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
               if (($2_1 | 0) == ($5_1 | 0)) {
                break label$91
               }
               label$92 : {
                $4_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
                if ($8_1 >>> 0 > $4_1 >>> 0) {
                 break label$92
                }
                HEAP32[($4_1 + 12 | 0) >> 2] | 0;
               }
               HEAP32[($4_1 + 12 | 0) >> 2] = $2_1;
               HEAP32[($2_1 + 8 | 0) >> 2] = $4_1;
               break label$90;
              }
              label$93 : {
               $4_1 = $5_1 + 20 | 0;
               $3_1 = HEAP32[$4_1 >> 2] | 0;
               if ($3_1) {
                break label$93
               }
               $4_1 = $5_1 + 16 | 0;
               $3_1 = HEAP32[$4_1 >> 2] | 0;
               if ($3_1) {
                break label$93
               }
               $2_1 = 0;
               break label$90;
              }
              label$94 : while (1) {
               $8_1 = $4_1;
               $2_1 = $3_1;
               $4_1 = $3_1 + 20 | 0;
               $3_1 = HEAP32[$4_1 >> 2] | 0;
               if ($3_1) {
                continue label$94
               }
               $4_1 = $2_1 + 16 | 0;
               $3_1 = HEAP32[($2_1 + 16 | 0) >> 2] | 0;
               if ($3_1) {
                continue label$94
               }
               break label$94;
              };
              HEAP32[$8_1 >> 2] = 0;
             }
             if (!$9_1) {
              break label$85
             }
             label$95 : {
              label$96 : {
               $3_1 = HEAP32[($5_1 + 28 | 0) >> 2] | 0;
               $4_1 = ($3_1 << 2 | 0) + 4232 | 0;
               if ((HEAP32[$4_1 >> 2] | 0 | 0) != ($5_1 | 0)) {
                break label$96
               }
               HEAP32[$4_1 >> 2] = $2_1;
               if ($2_1) {
                break label$95
               }
               HEAP32[(0 + 3932 | 0) >> 2] = (HEAP32[(0 + 3932 | 0) >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $3_1 | 0) | 0) | 0;
               break label$85;
              }
              HEAP32[($9_1 + ((HEAP32[($9_1 + 16 | 0) >> 2] | 0 | 0) == ($5_1 | 0) ? 16 : 20) | 0) >> 2] = $2_1;
              if (!$2_1) {
               break label$85
              }
             }
             HEAP32[($2_1 + 24 | 0) >> 2] = $9_1;
             label$97 : {
              $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
              if (!$4_1) {
               break label$97
              }
              HEAP32[($2_1 + 16 | 0) >> 2] = $4_1;
              HEAP32[($4_1 + 24 | 0) >> 2] = $2_1;
             }
             $4_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
             if (!$4_1) {
              break label$85
             }
             HEAP32[($2_1 + 20 | 0) >> 2] = $4_1;
             HEAP32[($4_1 + 24 | 0) >> 2] = $2_1;
            }
            $0_1 = $7_1 + $0_1 | 0;
            $5_1 = $5_1 + $7_1 | 0;
           }
           HEAP32[($5_1 + 4 | 0) >> 2] = (HEAP32[($5_1 + 4 | 0) >> 2] | 0) & -2 | 0;
           HEAP32[($6_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
           HEAP32[($6_1 + $0_1 | 0) >> 2] = $0_1;
           label$98 : {
            if ($0_1 >>> 0 > 255 >>> 0) {
             break label$98
            }
            $4_1 = $0_1 >>> 3 | 0;
            $0_1 = ($4_1 << 3 | 0) + 3968 | 0;
            label$99 : {
             label$100 : {
              $3_1 = HEAP32[(0 + 3928 | 0) >> 2] | 0;
              $4_1 = 1 << $4_1 | 0;
              if ($3_1 & $4_1 | 0) {
               break label$100
              }
              HEAP32[(0 + 3928 | 0) >> 2] = $3_1 | $4_1 | 0;
              $4_1 = $0_1;
              break label$99;
             }
             $4_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
            }
            HEAP32[($0_1 + 8 | 0) >> 2] = $6_1;
            HEAP32[($4_1 + 12 | 0) >> 2] = $6_1;
            HEAP32[($6_1 + 12 | 0) >> 2] = $0_1;
            HEAP32[($6_1 + 8 | 0) >> 2] = $4_1;
            break label$73;
           }
           $4_1 = 0;
           label$101 : {
            $3_1 = $0_1 >>> 8 | 0;
            if (!$3_1) {
             break label$101
            }
            $4_1 = 31;
            if ($0_1 >>> 0 > 16777215 >>> 0) {
             break label$101
            }
            $4_1 = (($3_1 + 1048320 | 0) >>> 16 | 0) & 8 | 0;
            $3_1 = $3_1 << $4_1 | 0;
            $1200 = $3_1;
            $3_1 = (($3_1 + 520192 | 0) >>> 16 | 0) & 4 | 0;
            $5_1 = $1200 << $3_1 | 0;
            $1207 = $5_1;
            $5_1 = (($5_1 + 245760 | 0) >>> 16 | 0) & 2 | 0;
            $4_1 = (($1207 << $5_1 | 0) >>> 15 | 0) - ($3_1 | $4_1 | 0 | $5_1 | 0) | 0;
            $4_1 = ($4_1 << 1 | 0 | (($0_1 >>> ($4_1 + 21 | 0) | 0) & 1 | 0) | 0) + 28 | 0;
           }
           HEAP32[($6_1 + 28 | 0) >> 2] = $4_1;
           i64toi32_i32$1 = $6_1;
           i64toi32_i32$0 = 0;
           HEAP32[($6_1 + 16 | 0) >> 2] = 0;
           HEAP32[($6_1 + 20 | 0) >> 2] = i64toi32_i32$0;
           $3_1 = ($4_1 << 2 | 0) + 4232 | 0;
           label$102 : {
            label$103 : {
             $5_1 = HEAP32[(0 + 3932 | 0) >> 2] | 0;
             $8_1 = 1 << $4_1 | 0;
             if ($5_1 & $8_1 | 0) {
              break label$103
             }
             HEAP32[(0 + 3932 | 0) >> 2] = $5_1 | $8_1 | 0;
             HEAP32[$3_1 >> 2] = $6_1;
             HEAP32[($6_1 + 24 | 0) >> 2] = $3_1;
             break label$102;
            }
            $4_1 = $0_1 << (($4_1 | 0) == (31 | 0) ? 0 : 25 - ($4_1 >>> 1 | 0) | 0) | 0;
            $5_1 = HEAP32[$3_1 >> 2] | 0;
            label$104 : while (1) {
             $3_1 = $5_1;
             if (((HEAP32[($5_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($0_1 | 0)) {
              break label$74
             }
             $5_1 = $4_1 >>> 29 | 0;
             $4_1 = $4_1 << 1 | 0;
             $8_1 = ($3_1 + ($5_1 & 4 | 0) | 0) + 16 | 0;
             $5_1 = HEAP32[$8_1 >> 2] | 0;
             if ($5_1) {
              continue label$104
             }
             break label$104;
            };
            HEAP32[$8_1 >> 2] = $6_1;
            HEAP32[($6_1 + 24 | 0) >> 2] = $3_1;
           }
           HEAP32[($6_1 + 12 | 0) >> 2] = $6_1;
           HEAP32[($6_1 + 8 | 0) >> 2] = $6_1;
           break label$73;
          }
          $0_1 = $2_1 + -40 | 0;
          $8_1 = ($5_1 + 8 | 0) & 7 | 0 ? (-8 - $5_1 | 0) & 7 | 0 : 0;
          $11_1 = $0_1 - $8_1 | 0;
          HEAP32[(0 + 3940 | 0) >> 2] = $11_1;
          $8_1 = $5_1 + $8_1 | 0;
          HEAP32[(0 + 3952 | 0) >> 2] = $8_1;
          HEAP32[($8_1 + 4 | 0) >> 2] = $11_1 | 1 | 0;
          HEAP32[(($5_1 + $0_1 | 0) + 4 | 0) >> 2] = 40;
          HEAP32[(0 + 3956 | 0) >> 2] = HEAP32[(0 + 4416 | 0) >> 2] | 0;
          $0_1 = ($6_1 + (($6_1 + -39 | 0) & 7 | 0 ? (39 - $6_1 | 0) & 7 | 0 : 0) | 0) + -47 | 0;
          $8_1 = $0_1 >>> 0 < ($4_1 + 16 | 0) >>> 0 ? $4_1 : $0_1;
          HEAP32[($8_1 + 4 | 0) >> 2] = 27;
          i64toi32_i32$2 = 0;
          i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4384 | 0) >> 2] | 0;
          i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4388 | 0) >> 2] | 0;
          $1329 = i64toi32_i32$0;
          i64toi32_i32$0 = $8_1 + 16 | 0;
          HEAP32[i64toi32_i32$0 >> 2] = $1329;
          HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$1;
          i64toi32_i32$2 = 0;
          i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4376 | 0) >> 2] | 0;
          i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4380 | 0) >> 2] | 0;
          $1331 = i64toi32_i32$1;
          i64toi32_i32$1 = $8_1;
          HEAP32[($8_1 + 8 | 0) >> 2] = $1331;
          HEAP32[($8_1 + 12 | 0) >> 2] = i64toi32_i32$0;
          HEAP32[(0 + 4384 | 0) >> 2] = $8_1 + 8 | 0;
          HEAP32[(0 + 4380 | 0) >> 2] = $2_1;
          HEAP32[(0 + 4376 | 0) >> 2] = $5_1;
          HEAP32[(0 + 4388 | 0) >> 2] = 0;
          $0_1 = $8_1 + 24 | 0;
          label$105 : while (1) {
           HEAP32[($0_1 + 4 | 0) >> 2] = 7;
           $5_1 = $0_1 + 8 | 0;
           $0_1 = $0_1 + 4 | 0;
           if ($6_1 >>> 0 > $5_1 >>> 0) {
            continue label$105
           }
           break label$105;
          };
          if (($8_1 | 0) == ($4_1 | 0)) {
           break label$63
          }
          HEAP32[($8_1 + 4 | 0) >> 2] = (HEAP32[($8_1 + 4 | 0) >> 2] | 0) & -2 | 0;
          $2_1 = $8_1 - $4_1 | 0;
          HEAP32[($4_1 + 4 | 0) >> 2] = $2_1 | 1 | 0;
          HEAP32[$8_1 >> 2] = $2_1;
          label$106 : {
           if ($2_1 >>> 0 > 255 >>> 0) {
            break label$106
           }
           $6_1 = $2_1 >>> 3 | 0;
           $0_1 = ($6_1 << 3 | 0) + 3968 | 0;
           label$107 : {
            label$108 : {
             $5_1 = HEAP32[(0 + 3928 | 0) >> 2] | 0;
             $6_1 = 1 << $6_1 | 0;
             if ($5_1 & $6_1 | 0) {
              break label$108
             }
             HEAP32[(0 + 3928 | 0) >> 2] = $5_1 | $6_1 | 0;
             $6_1 = $0_1;
             break label$107;
            }
            $6_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
           }
           HEAP32[($0_1 + 8 | 0) >> 2] = $4_1;
           HEAP32[($6_1 + 12 | 0) >> 2] = $4_1;
           HEAP32[($4_1 + 12 | 0) >> 2] = $0_1;
           HEAP32[($4_1 + 8 | 0) >> 2] = $6_1;
           break label$63;
          }
          $0_1 = 0;
          label$109 : {
           $6_1 = $2_1 >>> 8 | 0;
           if (!$6_1) {
            break label$109
           }
           $0_1 = 31;
           if ($2_1 >>> 0 > 16777215 >>> 0) {
            break label$109
           }
           $0_1 = (($6_1 + 1048320 | 0) >>> 16 | 0) & 8 | 0;
           $6_1 = $6_1 << $0_1 | 0;
           $1401 = $6_1;
           $6_1 = (($6_1 + 520192 | 0) >>> 16 | 0) & 4 | 0;
           $5_1 = $1401 << $6_1 | 0;
           $1408 = $5_1;
           $5_1 = (($5_1 + 245760 | 0) >>> 16 | 0) & 2 | 0;
           $0_1 = (($1408 << $5_1 | 0) >>> 15 | 0) - ($6_1 | $0_1 | 0 | $5_1 | 0) | 0;
           $0_1 = ($0_1 << 1 | 0 | (($2_1 >>> ($0_1 + 21 | 0) | 0) & 1 | 0) | 0) + 28 | 0;
          }
          i64toi32_i32$1 = $4_1;
          i64toi32_i32$0 = 0;
          HEAP32[($4_1 + 16 | 0) >> 2] = 0;
          HEAP32[($4_1 + 20 | 0) >> 2] = i64toi32_i32$0;
          HEAP32[($4_1 + 28 | 0) >> 2] = $0_1;
          $6_1 = ($0_1 << 2 | 0) + 4232 | 0;
          label$110 : {
           label$111 : {
            $5_1 = HEAP32[(0 + 3932 | 0) >> 2] | 0;
            $8_1 = 1 << $0_1 | 0;
            if ($5_1 & $8_1 | 0) {
             break label$111
            }
            HEAP32[(0 + 3932 | 0) >> 2] = $5_1 | $8_1 | 0;
            HEAP32[$6_1 >> 2] = $4_1;
            HEAP32[($4_1 + 24 | 0) >> 2] = $6_1;
            break label$110;
           }
           $0_1 = $2_1 << (($0_1 | 0) == (31 | 0) ? 0 : 25 - ($0_1 >>> 1 | 0) | 0) | 0;
           $5_1 = HEAP32[$6_1 >> 2] | 0;
           label$112 : while (1) {
            $6_1 = $5_1;
            if (((HEAP32[($5_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($2_1 | 0)) {
             break label$72
            }
            $5_1 = $0_1 >>> 29 | 0;
            $0_1 = $0_1 << 1 | 0;
            $8_1 = ($6_1 + ($5_1 & 4 | 0) | 0) + 16 | 0;
            $5_1 = HEAP32[$8_1 >> 2] | 0;
            if ($5_1) {
             continue label$112
            }
            break label$112;
           };
           HEAP32[$8_1 >> 2] = $4_1;
           HEAP32[($4_1 + 24 | 0) >> 2] = $6_1;
          }
          HEAP32[($4_1 + 12 | 0) >> 2] = $4_1;
          HEAP32[($4_1 + 8 | 0) >> 2] = $4_1;
          break label$63;
         }
         $0_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
         HEAP32[($0_1 + 12 | 0) >> 2] = $6_1;
         HEAP32[($3_1 + 8 | 0) >> 2] = $6_1;
         HEAP32[($6_1 + 24 | 0) >> 2] = 0;
         HEAP32[($6_1 + 12 | 0) >> 2] = $3_1;
         HEAP32[($6_1 + 8 | 0) >> 2] = $0_1;
        }
        $0_1 = $11_1 + 8 | 0;
        break label$3;
       }
       $0_1 = HEAP32[($6_1 + 8 | 0) >> 2] | 0;
       HEAP32[($0_1 + 12 | 0) >> 2] = $4_1;
       HEAP32[($6_1 + 8 | 0) >> 2] = $4_1;
       HEAP32[($4_1 + 24 | 0) >> 2] = 0;
       HEAP32[($4_1 + 12 | 0) >> 2] = $6_1;
       HEAP32[($4_1 + 8 | 0) >> 2] = $0_1;
      }
      $0_1 = HEAP32[(0 + 3940 | 0) >> 2] | 0;
      if ($0_1 >>> 0 <= $3_1 >>> 0) {
       break label$6
      }
      $4_1 = $0_1 - $3_1 | 0;
      HEAP32[(0 + 3940 | 0) >> 2] = $4_1;
      $0_1 = HEAP32[(0 + 3952 | 0) >> 2] | 0;
      $6_1 = $0_1 + $3_1 | 0;
      HEAP32[(0 + 3952 | 0) >> 2] = $6_1;
      HEAP32[($6_1 + 4 | 0) >> 2] = $4_1 | 1 | 0;
      HEAP32[($0_1 + 4 | 0) >> 2] = $3_1 | 3 | 0;
      $0_1 = $0_1 + 8 | 0;
      break label$3;
     }
     HEAP32[($56() | 0) >> 2] = 48;
     $0_1 = 0;
     break label$3;
    }
    label$113 : {
     if (!$11_1) {
      break label$113
     }
     label$114 : {
      label$115 : {
       $4_1 = HEAP32[($8_1 + 28 | 0) >> 2] | 0;
       $0_1 = ($4_1 << 2 | 0) + 4232 | 0;
       if (($8_1 | 0) != (HEAP32[$0_1 >> 2] | 0 | 0)) {
        break label$115
       }
       HEAP32[$0_1 >> 2] = $5_1;
       if ($5_1) {
        break label$114
       }
       $7_1 = $7_1 & (__wasm_rotl_i32(-2 | 0, $4_1 | 0) | 0) | 0;
       HEAP32[(0 + 3932 | 0) >> 2] = $7_1;
       break label$113;
      }
      HEAP32[($11_1 + ((HEAP32[($11_1 + 16 | 0) >> 2] | 0 | 0) == ($8_1 | 0) ? 16 : 20) | 0) >> 2] = $5_1;
      if (!$5_1) {
       break label$113
      }
     }
     HEAP32[($5_1 + 24 | 0) >> 2] = $11_1;
     label$116 : {
      $0_1 = HEAP32[($8_1 + 16 | 0) >> 2] | 0;
      if (!$0_1) {
       break label$116
      }
      HEAP32[($5_1 + 16 | 0) >> 2] = $0_1;
      HEAP32[($0_1 + 24 | 0) >> 2] = $5_1;
     }
     $0_1 = HEAP32[($8_1 + 20 | 0) >> 2] | 0;
     if (!$0_1) {
      break label$113
     }
     HEAP32[($5_1 + 20 | 0) >> 2] = $0_1;
     HEAP32[($0_1 + 24 | 0) >> 2] = $5_1;
    }
    label$117 : {
     label$118 : {
      if ($6_1 >>> 0 > 15 >>> 0) {
       break label$118
      }
      $0_1 = $6_1 + $3_1 | 0;
      HEAP32[($8_1 + 4 | 0) >> 2] = $0_1 | 3 | 0;
      $0_1 = $8_1 + $0_1 | 0;
      HEAP32[($0_1 + 4 | 0) >> 2] = HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 1 | 0;
      break label$117;
     }
     HEAP32[($8_1 + 4 | 0) >> 2] = $3_1 | 3 | 0;
     $5_1 = $8_1 + $3_1 | 0;
     HEAP32[($5_1 + 4 | 0) >> 2] = $6_1 | 1 | 0;
     HEAP32[($5_1 + $6_1 | 0) >> 2] = $6_1;
     label$119 : {
      if ($6_1 >>> 0 > 255 >>> 0) {
       break label$119
      }
      $4_1 = $6_1 >>> 3 | 0;
      $0_1 = ($4_1 << 3 | 0) + 3968 | 0;
      label$120 : {
       label$121 : {
        $6_1 = HEAP32[(0 + 3928 | 0) >> 2] | 0;
        $4_1 = 1 << $4_1 | 0;
        if ($6_1 & $4_1 | 0) {
         break label$121
        }
        HEAP32[(0 + 3928 | 0) >> 2] = $6_1 | $4_1 | 0;
        $4_1 = $0_1;
        break label$120;
       }
       $4_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
      }
      HEAP32[($0_1 + 8 | 0) >> 2] = $5_1;
      HEAP32[($4_1 + 12 | 0) >> 2] = $5_1;
      HEAP32[($5_1 + 12 | 0) >> 2] = $0_1;
      HEAP32[($5_1 + 8 | 0) >> 2] = $4_1;
      break label$117;
     }
     label$122 : {
      label$123 : {
       $4_1 = $6_1 >>> 8 | 0;
       if ($4_1) {
        break label$123
       }
       $0_1 = 0;
       break label$122;
      }
      $0_1 = 31;
      if ($6_1 >>> 0 > 16777215 >>> 0) {
       break label$122
      }
      $0_1 = (($4_1 + 1048320 | 0) >>> 16 | 0) & 8 | 0;
      $4_1 = $4_1 << $0_1 | 0;
      $1652 = $4_1;
      $4_1 = (($4_1 + 520192 | 0) >>> 16 | 0) & 4 | 0;
      $3_1 = $1652 << $4_1 | 0;
      $1659 = $3_1;
      $3_1 = (($3_1 + 245760 | 0) >>> 16 | 0) & 2 | 0;
      $0_1 = (($1659 << $3_1 | 0) >>> 15 | 0) - ($4_1 | $0_1 | 0 | $3_1 | 0) | 0;
      $0_1 = ($0_1 << 1 | 0 | (($6_1 >>> ($0_1 + 21 | 0) | 0) & 1 | 0) | 0) + 28 | 0;
     }
     HEAP32[($5_1 + 28 | 0) >> 2] = $0_1;
     i64toi32_i32$1 = $5_1;
     i64toi32_i32$0 = 0;
     HEAP32[($5_1 + 16 | 0) >> 2] = 0;
     HEAP32[($5_1 + 20 | 0) >> 2] = i64toi32_i32$0;
     $4_1 = ($0_1 << 2 | 0) + 4232 | 0;
     label$124 : {
      label$125 : {
       label$126 : {
        $3_1 = 1 << $0_1 | 0;
        if ($7_1 & $3_1 | 0) {
         break label$126
        }
        HEAP32[(0 + 3932 | 0) >> 2] = $7_1 | $3_1 | 0;
        HEAP32[$4_1 >> 2] = $5_1;
        HEAP32[($5_1 + 24 | 0) >> 2] = $4_1;
        break label$125;
       }
       $0_1 = $6_1 << (($0_1 | 0) == (31 | 0) ? 0 : 25 - ($0_1 >>> 1 | 0) | 0) | 0;
       $3_1 = HEAP32[$4_1 >> 2] | 0;
       label$127 : while (1) {
        $4_1 = $3_1;
        if (((HEAP32[($4_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($6_1 | 0)) {
         break label$124
        }
        $3_1 = $0_1 >>> 29 | 0;
        $0_1 = $0_1 << 1 | 0;
        $2_1 = ($4_1 + ($3_1 & 4 | 0) | 0) + 16 | 0;
        $3_1 = HEAP32[$2_1 >> 2] | 0;
        if ($3_1) {
         continue label$127
        }
        break label$127;
       };
       HEAP32[$2_1 >> 2] = $5_1;
       HEAP32[($5_1 + 24 | 0) >> 2] = $4_1;
      }
      HEAP32[($5_1 + 12 | 0) >> 2] = $5_1;
      HEAP32[($5_1 + 8 | 0) >> 2] = $5_1;
      break label$117;
     }
     $0_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
     HEAP32[($0_1 + 12 | 0) >> 2] = $5_1;
     HEAP32[($4_1 + 8 | 0) >> 2] = $5_1;
     HEAP32[($5_1 + 24 | 0) >> 2] = 0;
     HEAP32[($5_1 + 12 | 0) >> 2] = $4_1;
     HEAP32[($5_1 + 8 | 0) >> 2] = $0_1;
    }
    $0_1 = $8_1 + 8 | 0;
    break label$3;
   }
   label$128 : {
    if (!$10_1) {
     break label$128
    }
    label$129 : {
     label$130 : {
      $6_1 = HEAP32[($5_1 + 28 | 0) >> 2] | 0;
      $0_1 = ($6_1 << 2 | 0) + 4232 | 0;
      if (($5_1 | 0) != (HEAP32[$0_1 >> 2] | 0 | 0)) {
       break label$130
      }
      HEAP32[$0_1 >> 2] = $8_1;
      if ($8_1) {
       break label$129
      }
      HEAP32[(0 + 3932 | 0) >> 2] = $9_1 & (__wasm_rotl_i32(-2 | 0, $6_1 | 0) | 0) | 0;
      break label$128;
     }
     HEAP32[($10_1 + ((HEAP32[($10_1 + 16 | 0) >> 2] | 0 | 0) == ($5_1 | 0) ? 16 : 20) | 0) >> 2] = $8_1;
     if (!$8_1) {
      break label$128
     }
    }
    HEAP32[($8_1 + 24 | 0) >> 2] = $10_1;
    label$131 : {
     $0_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
     if (!$0_1) {
      break label$131
     }
     HEAP32[($8_1 + 16 | 0) >> 2] = $0_1;
     HEAP32[($0_1 + 24 | 0) >> 2] = $8_1;
    }
    $0_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
    if (!$0_1) {
     break label$128
    }
    HEAP32[($8_1 + 20 | 0) >> 2] = $0_1;
    HEAP32[($0_1 + 24 | 0) >> 2] = $8_1;
   }
   label$132 : {
    label$133 : {
     if ($4_1 >>> 0 > 15 >>> 0) {
      break label$133
     }
     $0_1 = $4_1 + $3_1 | 0;
     HEAP32[($5_1 + 4 | 0) >> 2] = $0_1 | 3 | 0;
     $0_1 = $5_1 + $0_1 | 0;
     HEAP32[($0_1 + 4 | 0) >> 2] = HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 1 | 0;
     break label$132;
    }
    HEAP32[($5_1 + 4 | 0) >> 2] = $3_1 | 3 | 0;
    $6_1 = $5_1 + $3_1 | 0;
    HEAP32[($6_1 + 4 | 0) >> 2] = $4_1 | 1 | 0;
    HEAP32[($6_1 + $4_1 | 0) >> 2] = $4_1;
    label$134 : {
     if (!$7_1) {
      break label$134
     }
     $8_1 = $7_1 >>> 3 | 0;
     $3_1 = ($8_1 << 3 | 0) + 3968 | 0;
     $0_1 = HEAP32[(0 + 3948 | 0) >> 2] | 0;
     label$135 : {
      label$136 : {
       $8_1 = 1 << $8_1 | 0;
       if ($8_1 & $2_1 | 0) {
        break label$136
       }
       HEAP32[(0 + 3928 | 0) >> 2] = $8_1 | $2_1 | 0;
       $8_1 = $3_1;
       break label$135;
      }
      $8_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
     }
     HEAP32[($3_1 + 8 | 0) >> 2] = $0_1;
     HEAP32[($8_1 + 12 | 0) >> 2] = $0_1;
     HEAP32[($0_1 + 12 | 0) >> 2] = $3_1;
     HEAP32[($0_1 + 8 | 0) >> 2] = $8_1;
    }
    HEAP32[(0 + 3948 | 0) >> 2] = $6_1;
    HEAP32[(0 + 3936 | 0) >> 2] = $4_1;
   }
   $0_1 = $5_1 + 8 | 0;
  }
  label$137 : {
   $13_1 = $1_1 + 16 | 0;
   if ($13_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $13_1;
  }
  return $0_1 | 0;
 }
 
 function $228($0_1) {
  $0_1 = $0_1 | 0;
  var $2_1 = 0, $5_1 = 0, $1_1 = 0, $4_1 = 0, $3_1 = 0, $7_1 = 0, $6_1 = 0, $408 = 0, $415 = 0;
  label$1 : {
   if (!$0_1) {
    break label$1
   }
   $1_1 = $0_1 + -8 | 0;
   $2_1 = HEAP32[($0_1 + -4 | 0) >> 2] | 0;
   $0_1 = $2_1 & -8 | 0;
   $3_1 = $1_1 + $0_1 | 0;
   label$2 : {
    if ($2_1 & 1 | 0) {
     break label$2
    }
    if (!($2_1 & 3 | 0)) {
     break label$1
    }
    $2_1 = HEAP32[$1_1 >> 2] | 0;
    $1_1 = $1_1 - $2_1 | 0;
    $4_1 = HEAP32[(0 + 3944 | 0) >> 2] | 0;
    if ($1_1 >>> 0 < $4_1 >>> 0) {
     break label$1
    }
    $0_1 = $2_1 + $0_1 | 0;
    label$3 : {
     if ((HEAP32[(0 + 3948 | 0) >> 2] | 0 | 0) == ($1_1 | 0)) {
      break label$3
     }
     label$4 : {
      if ($2_1 >>> 0 > 255 >>> 0) {
       break label$4
      }
      $5_1 = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
      label$5 : {
       $6_1 = HEAP32[($1_1 + 8 | 0) >> 2] | 0;
       $7_1 = $2_1 >>> 3 | 0;
       $2_1 = ($7_1 << 3 | 0) + 3968 | 0;
       if (($6_1 | 0) == ($2_1 | 0)) {
        break label$5
       }
      }
      label$6 : {
       if (($5_1 | 0) != ($6_1 | 0)) {
        break label$6
       }
       HEAP32[(0 + 3928 | 0) >> 2] = (HEAP32[(0 + 3928 | 0) >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $7_1 | 0) | 0) | 0;
       break label$2;
      }
      label$7 : {
       if (($5_1 | 0) == ($2_1 | 0)) {
        break label$7
       }
      }
      HEAP32[($6_1 + 12 | 0) >> 2] = $5_1;
      HEAP32[($5_1 + 8 | 0) >> 2] = $6_1;
      break label$2;
     }
     $7_1 = HEAP32[($1_1 + 24 | 0) >> 2] | 0;
     label$8 : {
      label$9 : {
       $5_1 = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
       if (($5_1 | 0) == ($1_1 | 0)) {
        break label$9
       }
       label$10 : {
        $2_1 = HEAP32[($1_1 + 8 | 0) >> 2] | 0;
        if ($4_1 >>> 0 > $2_1 >>> 0) {
         break label$10
        }
        HEAP32[($2_1 + 12 | 0) >> 2] | 0;
       }
       HEAP32[($2_1 + 12 | 0) >> 2] = $5_1;
       HEAP32[($5_1 + 8 | 0) >> 2] = $2_1;
       break label$8;
      }
      label$11 : {
       $2_1 = $1_1 + 20 | 0;
       $4_1 = HEAP32[$2_1 >> 2] | 0;
       if ($4_1) {
        break label$11
       }
       $2_1 = $1_1 + 16 | 0;
       $4_1 = HEAP32[$2_1 >> 2] | 0;
       if ($4_1) {
        break label$11
       }
       $5_1 = 0;
       break label$8;
      }
      label$12 : while (1) {
       $6_1 = $2_1;
       $5_1 = $4_1;
       $2_1 = $5_1 + 20 | 0;
       $4_1 = HEAP32[$2_1 >> 2] | 0;
       if ($4_1) {
        continue label$12
       }
       $2_1 = $5_1 + 16 | 0;
       $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
       if ($4_1) {
        continue label$12
       }
       break label$12;
      };
      HEAP32[$6_1 >> 2] = 0;
     }
     if (!$7_1) {
      break label$2
     }
     label$13 : {
      label$14 : {
       $4_1 = HEAP32[($1_1 + 28 | 0) >> 2] | 0;
       $2_1 = ($4_1 << 2 | 0) + 4232 | 0;
       if ((HEAP32[$2_1 >> 2] | 0 | 0) != ($1_1 | 0)) {
        break label$14
       }
       HEAP32[$2_1 >> 2] = $5_1;
       if ($5_1) {
        break label$13
       }
       HEAP32[(0 + 3932 | 0) >> 2] = (HEAP32[(0 + 3932 | 0) >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $4_1 | 0) | 0) | 0;
       break label$2;
      }
      HEAP32[($7_1 + ((HEAP32[($7_1 + 16 | 0) >> 2] | 0 | 0) == ($1_1 | 0) ? 16 : 20) | 0) >> 2] = $5_1;
      if (!$5_1) {
       break label$2
      }
     }
     HEAP32[($5_1 + 24 | 0) >> 2] = $7_1;
     label$15 : {
      $2_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
      if (!$2_1) {
       break label$15
      }
      HEAP32[($5_1 + 16 | 0) >> 2] = $2_1;
      HEAP32[($2_1 + 24 | 0) >> 2] = $5_1;
     }
     $2_1 = HEAP32[($1_1 + 20 | 0) >> 2] | 0;
     if (!$2_1) {
      break label$2
     }
     HEAP32[($5_1 + 20 | 0) >> 2] = $2_1;
     HEAP32[($2_1 + 24 | 0) >> 2] = $5_1;
     break label$2;
    }
    $2_1 = HEAP32[($3_1 + 4 | 0) >> 2] | 0;
    if (($2_1 & 3 | 0 | 0) != (3 | 0)) {
     break label$2
    }
    HEAP32[(0 + 3936 | 0) >> 2] = $0_1;
    HEAP32[($3_1 + 4 | 0) >> 2] = $2_1 & -2 | 0;
    HEAP32[($1_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
    HEAP32[($1_1 + $0_1 | 0) >> 2] = $0_1;
    return;
   }
   if ($3_1 >>> 0 <= $1_1 >>> 0) {
    break label$1
   }
   $2_1 = HEAP32[($3_1 + 4 | 0) >> 2] | 0;
   if (!($2_1 & 1 | 0)) {
    break label$1
   }
   label$16 : {
    label$17 : {
     if ($2_1 & 2 | 0) {
      break label$17
     }
     label$18 : {
      if ((HEAP32[(0 + 3952 | 0) >> 2] | 0 | 0) != ($3_1 | 0)) {
       break label$18
      }
      HEAP32[(0 + 3952 | 0) >> 2] = $1_1;
      $0_1 = (HEAP32[(0 + 3940 | 0) >> 2] | 0) + $0_1 | 0;
      HEAP32[(0 + 3940 | 0) >> 2] = $0_1;
      HEAP32[($1_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
      if (($1_1 | 0) != (HEAP32[(0 + 3948 | 0) >> 2] | 0 | 0)) {
       break label$1
      }
      HEAP32[(0 + 3936 | 0) >> 2] = 0;
      HEAP32[(0 + 3948 | 0) >> 2] = 0;
      return;
     }
     label$19 : {
      if ((HEAP32[(0 + 3948 | 0) >> 2] | 0 | 0) != ($3_1 | 0)) {
       break label$19
      }
      HEAP32[(0 + 3948 | 0) >> 2] = $1_1;
      $0_1 = (HEAP32[(0 + 3936 | 0) >> 2] | 0) + $0_1 | 0;
      HEAP32[(0 + 3936 | 0) >> 2] = $0_1;
      HEAP32[($1_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
      HEAP32[($1_1 + $0_1 | 0) >> 2] = $0_1;
      return;
     }
     $0_1 = ($2_1 & -8 | 0) + $0_1 | 0;
     label$20 : {
      label$21 : {
       if ($2_1 >>> 0 > 255 >>> 0) {
        break label$21
       }
       $4_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
       label$22 : {
        $5_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
        $3_1 = $2_1 >>> 3 | 0;
        $2_1 = ($3_1 << 3 | 0) + 3968 | 0;
        if (($5_1 | 0) == ($2_1 | 0)) {
         break label$22
        }
        HEAP32[(0 + 3944 | 0) >> 2] | 0;
       }
       label$23 : {
        if (($4_1 | 0) != ($5_1 | 0)) {
         break label$23
        }
        HEAP32[(0 + 3928 | 0) >> 2] = (HEAP32[(0 + 3928 | 0) >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $3_1 | 0) | 0) | 0;
        break label$20;
       }
       label$24 : {
        if (($4_1 | 0) == ($2_1 | 0)) {
         break label$24
        }
        HEAP32[(0 + 3944 | 0) >> 2] | 0;
       }
       HEAP32[($5_1 + 12 | 0) >> 2] = $4_1;
       HEAP32[($4_1 + 8 | 0) >> 2] = $5_1;
       break label$20;
      }
      $7_1 = HEAP32[($3_1 + 24 | 0) >> 2] | 0;
      label$25 : {
       label$26 : {
        $5_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
        if (($5_1 | 0) == ($3_1 | 0)) {
         break label$26
        }
        label$27 : {
         $2_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
         if ((HEAP32[(0 + 3944 | 0) >> 2] | 0) >>> 0 > $2_1 >>> 0) {
          break label$27
         }
         HEAP32[($2_1 + 12 | 0) >> 2] | 0;
        }
        HEAP32[($2_1 + 12 | 0) >> 2] = $5_1;
        HEAP32[($5_1 + 8 | 0) >> 2] = $2_1;
        break label$25;
       }
       label$28 : {
        $2_1 = $3_1 + 20 | 0;
        $4_1 = HEAP32[$2_1 >> 2] | 0;
        if ($4_1) {
         break label$28
        }
        $2_1 = $3_1 + 16 | 0;
        $4_1 = HEAP32[$2_1 >> 2] | 0;
        if ($4_1) {
         break label$28
        }
        $5_1 = 0;
        break label$25;
       }
       label$29 : while (1) {
        $6_1 = $2_1;
        $5_1 = $4_1;
        $2_1 = $5_1 + 20 | 0;
        $4_1 = HEAP32[$2_1 >> 2] | 0;
        if ($4_1) {
         continue label$29
        }
        $2_1 = $5_1 + 16 | 0;
        $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
        if ($4_1) {
         continue label$29
        }
        break label$29;
       };
       HEAP32[$6_1 >> 2] = 0;
      }
      if (!$7_1) {
       break label$20
      }
      label$30 : {
       label$31 : {
        $4_1 = HEAP32[($3_1 + 28 | 0) >> 2] | 0;
        $2_1 = ($4_1 << 2 | 0) + 4232 | 0;
        if ((HEAP32[$2_1 >> 2] | 0 | 0) != ($3_1 | 0)) {
         break label$31
        }
        HEAP32[$2_1 >> 2] = $5_1;
        if ($5_1) {
         break label$30
        }
        HEAP32[(0 + 3932 | 0) >> 2] = (HEAP32[(0 + 3932 | 0) >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $4_1 | 0) | 0) | 0;
        break label$20;
       }
       HEAP32[($7_1 + ((HEAP32[($7_1 + 16 | 0) >> 2] | 0 | 0) == ($3_1 | 0) ? 16 : 20) | 0) >> 2] = $5_1;
       if (!$5_1) {
        break label$20
       }
      }
      HEAP32[($5_1 + 24 | 0) >> 2] = $7_1;
      label$32 : {
       $2_1 = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
       if (!$2_1) {
        break label$32
       }
       HEAP32[($5_1 + 16 | 0) >> 2] = $2_1;
       HEAP32[($2_1 + 24 | 0) >> 2] = $5_1;
      }
      $2_1 = HEAP32[($3_1 + 20 | 0) >> 2] | 0;
      if (!$2_1) {
       break label$20
      }
      HEAP32[($5_1 + 20 | 0) >> 2] = $2_1;
      HEAP32[($2_1 + 24 | 0) >> 2] = $5_1;
     }
     HEAP32[($1_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
     HEAP32[($1_1 + $0_1 | 0) >> 2] = $0_1;
     if (($1_1 | 0) != (HEAP32[(0 + 3948 | 0) >> 2] | 0 | 0)) {
      break label$16
     }
     HEAP32[(0 + 3936 | 0) >> 2] = $0_1;
     return;
    }
    HEAP32[($3_1 + 4 | 0) >> 2] = $2_1 & -2 | 0;
    HEAP32[($1_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
    HEAP32[($1_1 + $0_1 | 0) >> 2] = $0_1;
   }
   label$33 : {
    if ($0_1 >>> 0 > 255 >>> 0) {
     break label$33
    }
    $2_1 = $0_1 >>> 3 | 0;
    $0_1 = ($2_1 << 3 | 0) + 3968 | 0;
    label$34 : {
     label$35 : {
      $4_1 = HEAP32[(0 + 3928 | 0) >> 2] | 0;
      $2_1 = 1 << $2_1 | 0;
      if ($4_1 & $2_1 | 0) {
       break label$35
      }
      HEAP32[(0 + 3928 | 0) >> 2] = $4_1 | $2_1 | 0;
      $2_1 = $0_1;
      break label$34;
     }
     $2_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
    }
    HEAP32[($0_1 + 8 | 0) >> 2] = $1_1;
    HEAP32[($2_1 + 12 | 0) >> 2] = $1_1;
    HEAP32[($1_1 + 12 | 0) >> 2] = $0_1;
    HEAP32[($1_1 + 8 | 0) >> 2] = $2_1;
    return;
   }
   $2_1 = 0;
   label$36 : {
    $4_1 = $0_1 >>> 8 | 0;
    if (!$4_1) {
     break label$36
    }
    $2_1 = 31;
    if ($0_1 >>> 0 > 16777215 >>> 0) {
     break label$36
    }
    $2_1 = (($4_1 + 1048320 | 0) >>> 16 | 0) & 8 | 0;
    $4_1 = $4_1 << $2_1 | 0;
    $408 = $4_1;
    $4_1 = (($4_1 + 520192 | 0) >>> 16 | 0) & 4 | 0;
    $5_1 = $408 << $4_1 | 0;
    $415 = $5_1;
    $5_1 = (($5_1 + 245760 | 0) >>> 16 | 0) & 2 | 0;
    $2_1 = (($415 << $5_1 | 0) >>> 15 | 0) - ($4_1 | $2_1 | 0 | $5_1 | 0) | 0;
    $2_1 = ($2_1 << 1 | 0 | (($0_1 >>> ($2_1 + 21 | 0) | 0) & 1 | 0) | 0) + 28 | 0;
   }
   HEAP32[($1_1 + 16 | 0) >> 2] = 0;
   HEAP32[($1_1 + 20 | 0) >> 2] = 0;
   HEAP32[($1_1 + 28 | 0) >> 2] = $2_1;
   $4_1 = ($2_1 << 2 | 0) + 4232 | 0;
   label$37 : {
    label$38 : {
     label$39 : {
      label$40 : {
       $5_1 = HEAP32[(0 + 3932 | 0) >> 2] | 0;
       $3_1 = 1 << $2_1 | 0;
       if ($5_1 & $3_1 | 0) {
        break label$40
       }
       HEAP32[(0 + 3932 | 0) >> 2] = $5_1 | $3_1 | 0;
       HEAP32[$4_1 >> 2] = $1_1;
       HEAP32[($1_1 + 24 | 0) >> 2] = $4_1;
       break label$39;
      }
      $2_1 = $0_1 << (($2_1 | 0) == (31 | 0) ? 0 : 25 - ($2_1 >>> 1 | 0) | 0) | 0;
      $5_1 = HEAP32[$4_1 >> 2] | 0;
      label$41 : while (1) {
       $4_1 = $5_1;
       if (((HEAP32[($5_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($0_1 | 0)) {
        break label$38
       }
       $5_1 = $2_1 >>> 29 | 0;
       $2_1 = $2_1 << 1 | 0;
       $3_1 = ($4_1 + ($5_1 & 4 | 0) | 0) + 16 | 0;
       $5_1 = HEAP32[$3_1 >> 2] | 0;
       if ($5_1) {
        continue label$41
       }
       break label$41;
      };
      HEAP32[$3_1 >> 2] = $1_1;
      HEAP32[($1_1 + 24 | 0) >> 2] = $4_1;
     }
     HEAP32[($1_1 + 12 | 0) >> 2] = $1_1;
     HEAP32[($1_1 + 8 | 0) >> 2] = $1_1;
     break label$37;
    }
    $0_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
    HEAP32[($0_1 + 12 | 0) >> 2] = $1_1;
    HEAP32[($4_1 + 8 | 0) >> 2] = $1_1;
    HEAP32[($1_1 + 24 | 0) >> 2] = 0;
    HEAP32[($1_1 + 12 | 0) >> 2] = $4_1;
    HEAP32[($1_1 + 8 | 0) >> 2] = $0_1;
   }
   $1_1 = (HEAP32[(0 + 3960 | 0) >> 2] | 0) + -1 | 0;
   HEAP32[(0 + 3960 | 0) >> 2] = $1_1;
   if ($1_1) {
    break label$1
   }
   $1_1 = 4384;
   label$42 : while (1) {
    $0_1 = HEAP32[$1_1 >> 2] | 0;
    $1_1 = $0_1 + 8 | 0;
    if ($0_1) {
     continue label$42
    }
    break label$42;
   };
   HEAP32[(0 + 3960 | 0) >> 2] = -1;
  }
 }
 
 function $229($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $3_1 = 0, $2_1 = 0;
  $1_1 = $0() | 0;
  $2_1 = __wasm_memory_size();
  label$1 : {
   $3_1 = HEAP32[$1_1 >> 2] | 0;
   $0_1 = $3_1 + (($0_1 + 3 | 0) & -4 | 0) | 0;
   if ($0_1 >>> 0 <= ($2_1 << 16 | 0) >>> 0) {
    break label$1
   }
   if (fimport$12($0_1 | 0) | 0) {
    break label$1
   }
   HEAP32[($56() | 0) >> 2] = 48;
   return -1 | 0;
  }
  HEAP32[$1_1 >> 2] = $0_1;
  return $3_1 | 0;
 }
 
 function $230($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $4_1 = 0, $3_1 = 0, $5_1 = 0;
  label$1 : {
   if ($2_1 >>> 0 < 512 >>> 0) {
    break label$1
   }
   fimport$13($0_1 | 0, $1_1 | 0, $2_1 | 0) | 0;
   return $0_1 | 0;
  }
  $3_1 = $0_1 + $2_1 | 0;
  label$2 : {
   label$3 : {
    if (($1_1 ^ $0_1 | 0) & 3 | 0) {
     break label$3
    }
    label$4 : {
     label$5 : {
      if (($2_1 | 0) >= (1 | 0)) {
       break label$5
      }
      $2_1 = $0_1;
      break label$4;
     }
     label$6 : {
      if ($0_1 & 3 | 0) {
       break label$6
      }
      $2_1 = $0_1;
      break label$4;
     }
     $2_1 = $0_1;
     label$7 : while (1) {
      HEAP8[$2_1 >> 0] = HEAPU8[$1_1 >> 0] | 0;
      $1_1 = $1_1 + 1 | 0;
      $2_1 = $2_1 + 1 | 0;
      if ($2_1 >>> 0 >= $3_1 >>> 0) {
       break label$4
      }
      if ($2_1 & 3 | 0) {
       continue label$7
      }
      break label$7;
     };
    }
    label$8 : {
     $4_1 = $3_1 & -4 | 0;
     if ($4_1 >>> 0 < 64 >>> 0) {
      break label$8
     }
     $5_1 = $4_1 + -64 | 0;
     if ($2_1 >>> 0 > $5_1 >>> 0) {
      break label$8
     }
     label$9 : while (1) {
      HEAP32[$2_1 >> 2] = HEAP32[$1_1 >> 2] | 0;
      HEAP32[($2_1 + 4 | 0) >> 2] = HEAP32[($1_1 + 4 | 0) >> 2] | 0;
      HEAP32[($2_1 + 8 | 0) >> 2] = HEAP32[($1_1 + 8 | 0) >> 2] | 0;
      HEAP32[($2_1 + 12 | 0) >> 2] = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
      HEAP32[($2_1 + 16 | 0) >> 2] = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
      HEAP32[($2_1 + 20 | 0) >> 2] = HEAP32[($1_1 + 20 | 0) >> 2] | 0;
      HEAP32[($2_1 + 24 | 0) >> 2] = HEAP32[($1_1 + 24 | 0) >> 2] | 0;
      HEAP32[($2_1 + 28 | 0) >> 2] = HEAP32[($1_1 + 28 | 0) >> 2] | 0;
      HEAP32[($2_1 + 32 | 0) >> 2] = HEAP32[($1_1 + 32 | 0) >> 2] | 0;
      HEAP32[($2_1 + 36 | 0) >> 2] = HEAP32[($1_1 + 36 | 0) >> 2] | 0;
      HEAP32[($2_1 + 40 | 0) >> 2] = HEAP32[($1_1 + 40 | 0) >> 2] | 0;
      HEAP32[($2_1 + 44 | 0) >> 2] = HEAP32[($1_1 + 44 | 0) >> 2] | 0;
      HEAP32[($2_1 + 48 | 0) >> 2] = HEAP32[($1_1 + 48 | 0) >> 2] | 0;
      HEAP32[($2_1 + 52 | 0) >> 2] = HEAP32[($1_1 + 52 | 0) >> 2] | 0;
      HEAP32[($2_1 + 56 | 0) >> 2] = HEAP32[($1_1 + 56 | 0) >> 2] | 0;
      HEAP32[($2_1 + 60 | 0) >> 2] = HEAP32[($1_1 + 60 | 0) >> 2] | 0;
      $1_1 = $1_1 + 64 | 0;
      $2_1 = $2_1 + 64 | 0;
      if ($2_1 >>> 0 <= $5_1 >>> 0) {
       continue label$9
      }
      break label$9;
     };
    }
    if ($2_1 >>> 0 >= $4_1 >>> 0) {
     break label$2
    }
    label$10 : while (1) {
     HEAP32[$2_1 >> 2] = HEAP32[$1_1 >> 2] | 0;
     $1_1 = $1_1 + 4 | 0;
     $2_1 = $2_1 + 4 | 0;
     if ($2_1 >>> 0 < $4_1 >>> 0) {
      continue label$10
     }
     break label$2;
    };
   }
   label$11 : {
    if ($3_1 >>> 0 >= 4 >>> 0) {
     break label$11
    }
    $2_1 = $0_1;
    break label$2;
   }
   label$12 : {
    $4_1 = $3_1 + -4 | 0;
    if ($4_1 >>> 0 >= $0_1 >>> 0) {
     break label$12
    }
    $2_1 = $0_1;
    break label$2;
   }
   $2_1 = $0_1;
   label$13 : while (1) {
    HEAP8[$2_1 >> 0] = HEAPU8[$1_1 >> 0] | 0;
    HEAP8[($2_1 + 1 | 0) >> 0] = HEAPU8[($1_1 + 1 | 0) >> 0] | 0;
    HEAP8[($2_1 + 2 | 0) >> 0] = HEAPU8[($1_1 + 2 | 0) >> 0] | 0;
    HEAP8[($2_1 + 3 | 0) >> 0] = HEAPU8[($1_1 + 3 | 0) >> 0] | 0;
    $1_1 = $1_1 + 4 | 0;
    $2_1 = $2_1 + 4 | 0;
    if ($2_1 >>> 0 <= $4_1 >>> 0) {
     continue label$13
    }
    break label$13;
   };
  }
  label$14 : {
   if ($2_1 >>> 0 >= $3_1 >>> 0) {
    break label$14
   }
   label$15 : while (1) {
    HEAP8[$2_1 >> 0] = HEAPU8[$1_1 >> 0] | 0;
    $1_1 = $1_1 + 1 | 0;
    $2_1 = $2_1 + 1 | 0;
    if (($2_1 | 0) != ($3_1 | 0)) {
     continue label$15
    }
    break label$15;
   };
  }
  return $0_1 | 0;
 }
 
 function $231($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, i64toi32_i32$2 = 0, i64toi32_i32$0 = 0, $4_1 = 0, $6_1 = 0, i64toi32_i32$1 = 0, i64toi32_i32$4 = 0, $6$hi = 0, i64toi32_i32$3 = 0, $5_1 = 0, $14_1 = 0, $104$hi = 0;
  label$1 : {
   if (!$2_1) {
    break label$1
   }
   $3_1 = $2_1 + $0_1 | 0;
   HEAP8[($3_1 + -1 | 0) >> 0] = $1_1;
   HEAP8[$0_1 >> 0] = $1_1;
   if ($2_1 >>> 0 < 3 >>> 0) {
    break label$1
   }
   HEAP8[($3_1 + -2 | 0) >> 0] = $1_1;
   HEAP8[($0_1 + 1 | 0) >> 0] = $1_1;
   HEAP8[($3_1 + -3 | 0) >> 0] = $1_1;
   HEAP8[($0_1 + 2 | 0) >> 0] = $1_1;
   if ($2_1 >>> 0 < 7 >>> 0) {
    break label$1
   }
   HEAP8[($3_1 + -4 | 0) >> 0] = $1_1;
   HEAP8[($0_1 + 3 | 0) >> 0] = $1_1;
   if ($2_1 >>> 0 < 9 >>> 0) {
    break label$1
   }
   $4_1 = (0 - $0_1 | 0) & 3 | 0;
   $3_1 = $0_1 + $4_1 | 0;
   $1_1 = Math_imul($1_1 & 255 | 0, 16843009);
   HEAP32[$3_1 >> 2] = $1_1;
   $4_1 = ($2_1 - $4_1 | 0) & -4 | 0;
   $2_1 = $3_1 + $4_1 | 0;
   HEAP32[($2_1 + -4 | 0) >> 2] = $1_1;
   if ($4_1 >>> 0 < 9 >>> 0) {
    break label$1
   }
   HEAP32[($3_1 + 8 | 0) >> 2] = $1_1;
   HEAP32[($3_1 + 4 | 0) >> 2] = $1_1;
   HEAP32[($2_1 + -8 | 0) >> 2] = $1_1;
   HEAP32[($2_1 + -12 | 0) >> 2] = $1_1;
   if ($4_1 >>> 0 < 25 >>> 0) {
    break label$1
   }
   HEAP32[($3_1 + 24 | 0) >> 2] = $1_1;
   HEAP32[($3_1 + 20 | 0) >> 2] = $1_1;
   HEAP32[($3_1 + 16 | 0) >> 2] = $1_1;
   HEAP32[($3_1 + 12 | 0) >> 2] = $1_1;
   HEAP32[($2_1 + -16 | 0) >> 2] = $1_1;
   HEAP32[($2_1 + -20 | 0) >> 2] = $1_1;
   HEAP32[($2_1 + -24 | 0) >> 2] = $1_1;
   HEAP32[($2_1 + -28 | 0) >> 2] = $1_1;
   $5_1 = $3_1 & 4 | 0 | 24 | 0;
   $2_1 = $4_1 - $5_1 | 0;
   if ($2_1 >>> 0 < 32 >>> 0) {
    break label$1
   }
   i64toi32_i32$0 = 0;
   $6_1 = $1_1;
   $6$hi = i64toi32_i32$0;
   i64toi32_i32$2 = $1_1;
   i64toi32_i32$1 = 0;
   i64toi32_i32$3 = 32;
   i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
   if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
    i64toi32_i32$1 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
    $14_1 = 0;
   } else {
    i64toi32_i32$1 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$2 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$0 << i64toi32_i32$4 | 0) | 0;
    $14_1 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
   }
   $104$hi = i64toi32_i32$1;
   i64toi32_i32$1 = $6$hi;
   i64toi32_i32$1 = $104$hi;
   i64toi32_i32$0 = $14_1;
   i64toi32_i32$2 = $6$hi;
   i64toi32_i32$3 = $6_1;
   i64toi32_i32$2 = i64toi32_i32$1 | i64toi32_i32$2 | 0;
   $6_1 = i64toi32_i32$0 | $6_1 | 0;
   $6$hi = i64toi32_i32$2;
   $1_1 = $3_1 + $5_1 | 0;
   label$2 : while (1) {
    i64toi32_i32$2 = $6$hi;
    i64toi32_i32$0 = $1_1;
    HEAP32[($1_1 + 24 | 0) >> 2] = $6_1;
    HEAP32[($1_1 + 28 | 0) >> 2] = i64toi32_i32$2;
    i64toi32_i32$0 = $1_1;
    HEAP32[($1_1 + 16 | 0) >> 2] = $6_1;
    HEAP32[($1_1 + 20 | 0) >> 2] = i64toi32_i32$2;
    i64toi32_i32$0 = $1_1;
    HEAP32[($1_1 + 8 | 0) >> 2] = $6_1;
    HEAP32[($1_1 + 12 | 0) >> 2] = i64toi32_i32$2;
    i64toi32_i32$0 = $1_1;
    HEAP32[$1_1 >> 2] = $6_1;
    HEAP32[($1_1 + 4 | 0) >> 2] = i64toi32_i32$2;
    $1_1 = $1_1 + 32 | 0;
    $2_1 = $2_1 + -32 | 0;
    if ($2_1 >>> 0 > 31 >>> 0) {
     continue label$2
    }
    break label$2;
   };
  }
  return $0_1 | 0;
 }
 
 function $232($0_1) {
  $0_1 = $0_1 | 0;
 }
 
 function $233($0_1) {
  $0_1 = $0_1 | 0;
 }
 
 function $234() {
  $232(4424 | 0);
  return 4432 | 0;
 }
 
 function $235() {
  $233(4424 | 0);
 }
 
 function $236($0_1) {
  $0_1 = $0_1 | 0;
  return 1 | 0;
 }
 
 function $237($0_1) {
  $0_1 = $0_1 | 0;
 }
 
 function $238($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $2_1 = 0, $3_1 = 0;
  $1_1 = $0_1;
  label$1 : {
   label$2 : {
    if (!($0_1 & 3 | 0)) {
     break label$2
    }
    label$3 : {
     if (HEAPU8[$0_1 >> 0] | 0) {
      break label$3
     }
     return $0_1 - $0_1 | 0 | 0;
    }
    $1_1 = $0_1;
    label$4 : while (1) {
     $1_1 = $1_1 + 1 | 0;
     if (!($1_1 & 3 | 0)) {
      break label$2
     }
     if (!(HEAPU8[$1_1 >> 0] | 0)) {
      break label$1
     }
     continue label$4;
    };
   }
   label$5 : while (1) {
    $2_1 = $1_1;
    $1_1 = $1_1 + 4 | 0;
    $3_1 = HEAP32[$2_1 >> 2] | 0;
    if (!((($3_1 ^ -1 | 0) & ($3_1 + -16843009 | 0) | 0) & -2139062144 | 0)) {
     continue label$5
    }
    break label$5;
   };
   label$6 : {
    if ($3_1 & 255 | 0) {
     break label$6
    }
    return $2_1 - $0_1 | 0 | 0;
   }
   label$7 : while (1) {
    $3_1 = HEAPU8[($2_1 + 1 | 0) >> 0] | 0;
    $1_1 = $2_1 + 1 | 0;
    $2_1 = $1_1;
    if ($3_1) {
     continue label$7
    }
    break label$7;
   };
  }
  return $1_1 - $0_1 | 0 | 0;
 }
 
 function $239($0_1) {
  $0_1 = $0_1 | 0;
  var $2_1 = 0, $1_1 = 0;
  label$1 : {
   label$2 : {
    if (!$0_1) {
     break label$2
    }
    label$3 : {
     if ((HEAP32[($0_1 + 76 | 0) >> 2] | 0 | 0) > (-1 | 0)) {
      break label$3
     }
     return $240($0_1 | 0) | 0 | 0;
    }
    $1_1 = $236($0_1 | 0) | 0;
    $2_1 = $240($0_1 | 0) | 0;
    if (!$1_1) {
     break label$1
    }
    $237($0_1 | 0);
    return $2_1 | 0;
   }
   $2_1 = 0;
   label$4 : {
    if (!(HEAP32[(0 + 4436 | 0) >> 2] | 0)) {
     break label$4
    }
    $2_1 = $239(HEAP32[(0 + 4436 | 0) >> 2] | 0 | 0) | 0;
   }
   label$5 : {
    $0_1 = HEAP32[($234() | 0) >> 2] | 0;
    if (!$0_1) {
     break label$5
    }
    label$6 : while (1) {
     $1_1 = 0;
     label$7 : {
      if ((HEAP32[($0_1 + 76 | 0) >> 2] | 0 | 0) < (0 | 0)) {
       break label$7
      }
      $1_1 = $236($0_1 | 0) | 0;
     }
     label$8 : {
      if ((HEAP32[($0_1 + 20 | 0) >> 2] | 0) >>> 0 <= (HEAP32[($0_1 + 28 | 0) >> 2] | 0) >>> 0) {
       break label$8
      }
      $2_1 = $240($0_1 | 0) | 0 | $2_1 | 0;
     }
     label$9 : {
      if (!$1_1) {
       break label$9
      }
      $237($0_1 | 0);
     }
     $0_1 = HEAP32[($0_1 + 56 | 0) >> 2] | 0;
     if ($0_1) {
      continue label$6
     }
     break label$6;
    };
   }
   $235();
  }
  return $2_1 | 0;
 }
 
 function $240($0_1) {
  $0_1 = $0_1 | 0;
  var i64toi32_i32$1 = 0, i64toi32_i32$0 = 0, $1_1 = 0, $2_1 = 0;
  label$1 : {
   if ((HEAP32[($0_1 + 20 | 0) >> 2] | 0) >>> 0 <= (HEAP32[($0_1 + 28 | 0) >> 2] | 0) >>> 0) {
    break label$1
   }
   FUNCTION_TABLE[HEAP32[($0_1 + 36 | 0) >> 2] | 0]($0_1, 0, 0) | 0;
   if (HEAP32[($0_1 + 20 | 0) >> 2] | 0) {
    break label$1
   }
   return -1 | 0;
  }
  label$2 : {
   $1_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
   $2_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
   if ($1_1 >>> 0 >= $2_1 >>> 0) {
    break label$2
   }
   i64toi32_i32$1 = $1_1 - $2_1 | 0;
   i64toi32_i32$0 = i64toi32_i32$1 >> 31 | 0;
   i64toi32_i32$0 = FUNCTION_TABLE[HEAP32[($0_1 + 40 | 0) >> 2] | 0]($0_1, i64toi32_i32$1, i64toi32_i32$0, 1) | 0;
   i64toi32_i32$1 = i64toi32_i32$HIGH_BITS;
  }
  HEAP32[($0_1 + 28 | 0) >> 2] = 0;
  i64toi32_i32$0 = $0_1;
  i64toi32_i32$1 = 0;
  HEAP32[($0_1 + 16 | 0) >> 2] = 0;
  HEAP32[($0_1 + 20 | 0) >> 2] = i64toi32_i32$1;
  i64toi32_i32$0 = $0_1;
  i64toi32_i32$1 = 0;
  HEAP32[($0_1 + 4 | 0) >> 2] = 0;
  HEAP32[($0_1 + 8 | 0) >> 2] = i64toi32_i32$1;
  return 0 | 0;
 }
 
 function $241($0_1) {
  $0_1 = $0_1 | 0;
  global$2 = $0_1;
 }
 
 function $242() {
  return global$0 | 0;
 }
 
 function $243($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $2_1 = 0;
  label$1 : {
   $1_1 = (global$0 - $0_1 | 0) & -16 | 0;
   $2_1 = $1_1;
   if ($1_1 >>> 0 < global$2 >>> 0) {
    fimport$14()
   }
   global$0 = $2_1;
  }
  return $1_1 | 0;
 }
 
 function $244($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0;
  $1_1 = $0_1;
  if ($1_1 >>> 0 < global$2 >>> 0) {
   fimport$14()
  }
  global$0 = $1_1;
 }
 
 function $245($0_1) {
  $0_1 = $0_1 | 0;
  return abort() | 0;
 }
 
 function $246($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  return FUNCTION_TABLE[$0_1]($1_1) | 0 | 0;
 }
 
 function $247($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  FUNCTION_TABLE[$0_1]($1_1, $2_1, $3_1);
 }
 
 function $248($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  return FUNCTION_TABLE[$0_1]($1_1, $2_1) | 0 | 0;
 }
 
 function $249($0_1) {
  $0_1 = $0_1 | 0;
  return FUNCTION_TABLE[$0_1]() | 0 | 0;
 }
 
 function $250($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  FUNCTION_TABLE[$0_1]($1_1);
 }
 
 function $251($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  return FUNCTION_TABLE[$0_1]($1_1, $2_1, $3_1) | 0 | 0;
 }
 
 function $252($0_1, $1_1, $2_1, $3_1, $4_1, $5_1, $6_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  $6_1 = $6_1 | 0;
  FUNCTION_TABLE[$0_1]($1_1, $2_1, $3_1, $4_1, $5_1, $6_1);
 }
 
 function $253($0_1, $1_1, $2_1, $3_1, $4_1, $5_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  FUNCTION_TABLE[$0_1]($1_1, $2_1, $3_1, $4_1, $5_1);
 }
 
 function $254($0_1, $1_1, $2_1, $3_1, $4_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  FUNCTION_TABLE[$0_1]($1_1, $2_1, $3_1, $4_1);
 }
 
 function _ZN17compiler_builtins3int3mul3Mul3mul17h070e9a1c69faec5bE(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$4 = 0, i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, var$2 = 0, i64toi32_i32$2 = 0, i64toi32_i32$3 = 0, var$3 = 0, var$4 = 0, var$5 = 0, $21_1 = 0, $22_1 = 0, var$6 = 0, $24_1 = 0, $17_1 = 0, $18_1 = 0, $23_1 = 0, $29_1 = 0, $45_1 = 0, $56$hi = 0, $62$hi = 0;
  i64toi32_i32$0 = var$1$hi;
  var$2 = var$1;
  var$4 = var$2 >>> 16 | 0;
  i64toi32_i32$0 = var$0$hi;
  var$3 = var$0;
  var$5 = var$3 >>> 16 | 0;
  $17_1 = Math_imul(var$4, var$5);
  $18_1 = var$2;
  i64toi32_i32$2 = var$3;
  i64toi32_i32$1 = 0;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$1 = 0;
   $21_1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
  } else {
   i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
   $21_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
  }
  $23_1 = $17_1 + Math_imul($18_1, $21_1) | 0;
  i64toi32_i32$1 = var$1$hi;
  i64toi32_i32$0 = var$1;
  i64toi32_i32$2 = 0;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$2 = 0;
   $22_1 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
  } else {
   i64toi32_i32$2 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
   $22_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$0 >>> i64toi32_i32$4 | 0) | 0;
  }
  $29_1 = $23_1 + Math_imul($22_1, var$3) | 0;
  var$2 = var$2 & 65535 | 0;
  var$3 = var$3 & 65535 | 0;
  var$6 = Math_imul(var$2, var$3);
  var$2 = (var$6 >>> 16 | 0) + Math_imul(var$2, var$5) | 0;
  $45_1 = $29_1 + (var$2 >>> 16 | 0) | 0;
  var$2 = (var$2 & 65535 | 0) + Math_imul(var$4, var$3) | 0;
  i64toi32_i32$2 = 0;
  i64toi32_i32$1 = $45_1 + (var$2 >>> 16 | 0) | 0;
  i64toi32_i32$0 = 0;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$0 = i64toi32_i32$1 << i64toi32_i32$4 | 0;
   $24_1 = 0;
  } else {
   i64toi32_i32$0 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$1 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$2 << i64toi32_i32$4 | 0) | 0;
   $24_1 = i64toi32_i32$1 << i64toi32_i32$4 | 0;
  }
  $56$hi = i64toi32_i32$0;
  i64toi32_i32$0 = 0;
  $62$hi = i64toi32_i32$0;
  i64toi32_i32$0 = $56$hi;
  i64toi32_i32$2 = $24_1;
  i64toi32_i32$1 = $62$hi;
  i64toi32_i32$3 = var$2 << 16 | 0 | (var$6 & 65535 | 0) | 0;
  i64toi32_i32$1 = i64toi32_i32$0 | i64toi32_i32$1 | 0;
  i64toi32_i32$2 = i64toi32_i32$2 | i64toi32_i32$3 | 0;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$1;
  return i64toi32_i32$2 | 0;
 }
 
 function __wasm_i64_mul(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$0 = 0, i64toi32_i32$1 = 0;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$0 = var$1$hi;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$1 = var$1$hi;
  i64toi32_i32$1 = _ZN17compiler_builtins3int3mul3Mul3mul17h070e9a1c69faec5bE(var$0 | 0, i64toi32_i32$0 | 0, var$1 | 0, i64toi32_i32$1 | 0) | 0;
  i64toi32_i32$0 = i64toi32_i32$HIGH_BITS;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$0;
  return i64toi32_i32$1 | 0;
 }
 
 function __wasm_rotl_i32(var$0, var$1) {
  var$0 = var$0 | 0;
  var$1 = var$1 | 0;
  var var$2 = 0;
  var$2 = var$1 & 31 | 0;
  var$1 = (0 - var$1 | 0) & 31 | 0;
  return ((-1 >>> var$2 | 0) & var$0 | 0) << var$2 | 0 | (((-1 << var$1 | 0) & var$0 | 0) >>> var$1 | 0) | 0 | 0;
 }
 
 // EMSCRIPTEN_END_FUNCS
;
 FUNCTION_TABLE[1] = $11;
 FUNCTION_TABLE[2] = $9;
 FUNCTION_TABLE[3] = $12;
 FUNCTION_TABLE[4] = $13;
 FUNCTION_TABLE[5] = $14;
 FUNCTION_TABLE[6] = $15;
 FUNCTION_TABLE[7] = $16;
 FUNCTION_TABLE[8] = $41;
 FUNCTION_TABLE[9] = $33;
 FUNCTION_TABLE[10] = $61;
 FUNCTION_TABLE[11] = $64;
 FUNCTION_TABLE[12] = $62;
 FUNCTION_TABLE[13] = $63;
 FUNCTION_TABLE[14] = $69;
 FUNCTION_TABLE[15] = $65;
 FUNCTION_TABLE[16] = $73;
 FUNCTION_TABLE[17] = $93;
 FUNCTION_TABLE[18] = $90;
 FUNCTION_TABLE[19] = $76;
 FUNCTION_TABLE[20] = $66;
 FUNCTION_TABLE[21] = $92;
 FUNCTION_TABLE[22] = $89;
 FUNCTION_TABLE[23] = $77;
 FUNCTION_TABLE[24] = $67;
 FUNCTION_TABLE[25] = $91;
 FUNCTION_TABLE[26] = $86;
 FUNCTION_TABLE[27] = $79;
 FUNCTION_TABLE[28] = $68;
 FUNCTION_TABLE[29] = $81;
 FUNCTION_TABLE[30] = $186;
 function __wasm_memory_size() {
  return buffer.byteLength / 65536 | 0;
 }
 
 return {
  "__wasm_call_ctors": $1, 
  "calc": $9, 
  "__errno_location": $56, 
  "fflush": $239, 
  "__getTypeName": $95, 
  "__embind_register_native_and_builtin_types": $96, 
  "__set_stack_limit": $241, 
  "stackSave": $242, 
  "stackAlloc": $243, 
  "stackRestore": $244, 
  "__growWasmMemory": $245, 
  "dynCall_ii": $246, 
  "dynCall_viii": $247, 
  "dynCall_iii": $248, 
  "dynCall_i": $249, 
  "dynCall_vi": $250, 
  "dynCall_iiii": $251, 
  "dynCall_viiiiii": $252, 
  "dynCall_viiiii": $253, 
  "dynCall_viiii": $254
 };
}

for (var base64ReverseLookup = new Uint8Array(123/*'z'+1*/), i = 25; i >= 0; --i) {
    base64ReverseLookup[48+i] = 52+i; // '0-9'
    base64ReverseLookup[65+i] = i; // 'A-Z'
    base64ReverseLookup[97+i] = 26+i; // 'a-z'
  }
  base64ReverseLookup[43] = 62; // '+'
  base64ReverseLookup[47] = 63; // '/'
  /** @noinline Inlining this function would mean expanding the base64 string 4x times in the source code, which Closure seems to be happy to do. */
  function base64DecodeToExistingUint8Array(uint8Array, offset, b64) {
    var b1, b2, i = 0, j = offset, bLength = b64.length, end = offset + (bLength*3>>2);
    if (b64[bLength-2] == '=') --end;
    if (b64[bLength-1] == '=') --end;
    for (; i < bLength; i += 4, j += 3) {
      b1 = base64ReverseLookup[b64.charCodeAt(i+1)];
      b2 = base64ReverseLookup[b64.charCodeAt(i+2)];
      uint8Array[j] = base64ReverseLookup[b64.charCodeAt(i)] << 2 | b1 >> 4;
      if (j+1 < end) uint8Array[j+1] = b1 << 4 | b2 >> 2;
      if (j+2 < end) uint8Array[j+2] = b2 << 6 | base64ReverseLookup[b64.charCodeAt(i+3)];
    }
  }
var bufferView = new Uint8Array(wasmMemory.buffer);
base64DecodeToExistingUint8Array(bufferView, 1024, "UmV0dXJuU3RydWN0AGJhc2VQcmljZQBzZWxsUHJpY2VfMABzZWxsUHJpY2VfMQBzZWxsUHJpY2VfMgBzZWxsUHJpY2VfMwBzZWxsUHJpY2VfNABzZWxsUHJpY2VfNQBzZWxsUHJpY2VfNgBzZWxsUHJpY2VfNwBzZWxsUHJpY2VfOABzZWxsUHJpY2VfOQBzZWxsUHJpY2VfMTAAc2VsbFByaWNlXzExAGNhbGMAMTJSZXR1cm5TdHJ1Y3QAAAAAfAcAAK4EAABQMTJSZXR1cm5TdHJ1Y3QAXAgAAMgEAAAAAAAAwAQAAFBLMTJSZXR1cm5TdHJ1Y3QAAAAAXAgAAOgEAAABAAAAwAQAAGlpAHYAdmkA2AQAAGlpaQB2aWlpAAAAAMAEAAA8BwAAPAcAAGlpaWkAU3Q5dHlwZV9pbmZvAAAAfAcAADUFAABOMTBfX2N4eGFiaXYxMTZfX3NoaW1fdHlwZV9pbmZvRQAAAACkBwAATAUAAEQFAABOMTBfX2N4eGFiaXYxMTdfX2NsYXNzX3R5cGVfaW5mb0UAAACkBwAAfAUAAHAFAABOMTBfX2N4eGFiaXYxMTdfX3BiYXNlX3R5cGVfaW5mb0UAAACkBwAArAUAAHAFAABOMTBfX2N4eGFiaXYxMTlfX3BvaW50ZXJfdHlwZV9pbmZvRQCkBwAA3AUAANAFAABOMTBfX2N4eGFiaXYxMjBfX2Z1bmN0aW9uX3R5cGVfaW5mb0UAAAAApAcAAAwGAABwBQAATjEwX19jeHhhYml2MTI5X19wb2ludGVyX3RvX21lbWJlcl90eXBlX2luZm9FAAAApAcAAEAGAADQBQAAAAAAAMAGAAAKAAAACwAAAAwAAAANAAAADgAAAE4xMF9fY3h4YWJpdjEyM19fZnVuZGFtZW50YWxfdHlwZV9pbmZvRQCkBwAAmAYAAHAFAAB2AAAAhAYAAMwGAABEbgAAhAYAANgGAABiAAAAhAYAAOQGAABjAAAAhAYAAPAGAABoAAAAhAYAAPwGAABhAAAAhAYAAAgHAABzAAAAhAYAABQHAAB0AAAAhAYAACAHAABpAAAAhAYAACwHAABqAAAAhAYAADgHAABsAAAAhAYAAEQHAABtAAAAhAYAAFAHAABmAAAAhAYAAFwHAABkAAAAhAYAAGgHAAAAAAAAoAUAAAoAAAAPAAAADAAAAA0AAAAQAAAAEQAAABIAAAATAAAAAAAAAOwHAAAKAAAAFAAAAAwAAAANAAAAEAAAABUAAAAWAAAAFwAAAE4xMF9fY3h4YWJpdjEyMF9fc2lfY2xhc3NfdHlwZV9pbmZvRQAAAACkBwAAxAcAAKAFAAAAAAAASAgAAAoAAAAYAAAADAAAAA0AAAAQAAAAGQAAABoAAAAbAAAATjEwX19jeHhhYml2MTIxX192bWlfY2xhc3NfdHlwZV9pbmZvRQAAAKQHAAAgCAAAoAUAAAAAAAAABgAACgAAABwAAAAMAAAADQAAAB0AAAB2b2lkAGJvb2wAY2hhcgBzaWduZWQgY2hhcgB1bnNpZ25lZCBjaGFyAHNob3J0AHVuc2lnbmVkIHNob3J0AGludAB1bnNpZ25lZCBpbnQAbG9uZwB1bnNpZ25lZCBsb25nAGZsb2F0AGRvdWJsZQBzdGQ6OnN0cmluZwBzdGQ6OmJhc2ljX3N0cmluZzx1bnNpZ25lZCBjaGFyPgBzdGQ6OndzdHJpbmcAc3RkOjp1MTZzdHJpbmcAc3RkOjp1MzJzdHJpbmcAZW1zY3JpcHRlbjo6dmFsAGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGNoYXI+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHNpZ25lZCBjaGFyPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1bnNpZ25lZCBjaGFyPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxzaG9ydD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8dW5zaWduZWQgc2hvcnQ+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGludD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8dW5zaWduZWQgaW50PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxsb25nPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1bnNpZ25lZCBsb25nPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxpbnQ4X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHVpbnQ4X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGludDE2X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHVpbnQxNl90PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxpbnQzMl90PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1aW50MzJfdD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8ZmxvYXQ+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGRvdWJsZT4ATlN0M19fMjEyYmFzaWNfc3RyaW5nSWNOU18xMWNoYXJfdHJhaXRzSWNFRU5TXzlhbGxvY2F0b3JJY0VFRUUATlN0M19fMjIxX19iYXNpY19zdHJpbmdfY29tbW9uSUxiMUVFRQAAfAcAAMULAAAACAAAhgsAAAAAAAABAAAA7AsAAAAAAABOU3QzX18yMTJiYXNpY19zdHJpbmdJaE5TXzExY2hhcl90cmFpdHNJaEVFTlNfOWFsbG9jYXRvckloRUVFRQAAAAgAAAwMAAAAAAAAAQAAAOwLAAAAAAAATlN0M19fMjEyYmFzaWNfc3RyaW5nSXdOU18xMWNoYXJfdHJhaXRzSXdFRU5TXzlhbGxvY2F0b3JJd0VFRUUAAAAIAABkDAAAAAAAAAEAAADsCwAAAAAAAE5TdDNfXzIxMmJhc2ljX3N0cmluZ0lEc05TXzExY2hhcl90cmFpdHNJRHNFRU5TXzlhbGxvY2F0b3JJRHNFRUVFAAAAAAgAALwMAAAAAAAAAQAAAOwLAAAAAAAATlN0M19fMjEyYmFzaWNfc3RyaW5nSURpTlNfMTFjaGFyX3RyYWl0c0lEaUVFTlNfOWFsbG9jYXRvcklEaUVFRUUAAAAACAAAGA0AAAAAAAABAAAA7AsAAAAAAABOMTBlbXNjcmlwdGVuM3ZhbEUAAHwHAAB0DQAATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJY0VFAAB8BwAAkA0AAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWFFRQAAfAcAALgNAABOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0loRUUAAHwHAADgDQAATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJc0VFAAB8BwAACA4AAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SXRFRQAAfAcAADAOAABOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0lpRUUAAHwHAABYDgAATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJakVFAAB8BwAAgA4AAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWxFRQAAfAcAAKgOAABOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0ltRUUAAHwHAADQDgAATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJZkVFAAB8BwAA+A4AAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWRFRQAAfAcAACAPAAA=");
base64DecodeToExistingUint8Array(bufferView, 3912, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
return asmFunc({
    'Int8Array': Int8Array,
    'Int16Array': Int16Array,
    'Int32Array': Int32Array,
    'Uint8Array': Uint8Array,
    'Uint16Array': Uint16Array,
    'Uint32Array': Uint32Array,
    'Float32Array': Float32Array,
    'Float64Array': Float64Array,
    'NaN': NaN,
    'Infinity': Infinity,
    'Math': Math
  },
  asmLibraryArg,
  wasmMemory.buffer
)

}
)(asmLibraryArg, wasmMemory, wasmTable);
    return {
      'exports': exports
    };
  },

  instantiate: /** @suppress{checkTypes} */ function(binary, info) {
    return {
      then: function(ok) {
        ok({
          'instance': new WebAssembly.Instance(new WebAssembly.Module(binary))
        });
        // Emulate a simple WebAssembly.instantiate(..).then(()=>{}).catch(()=>{}) syntax.
        return { catch: function() {} };
      }
    };
  },

  RuntimeError: Error
};

// We don't need to actually download a wasm binary, mark it as present but empty.
wasmBinary = [];



if (typeof WebAssembly !== 'object') {
  abort('No WebAssembly support found. Build with -s WASM=0 to target JavaScript instead.');
}


// In MINIMAL_RUNTIME, setValue() and getValue() are only available when building with safe heap enabled, for heap safety checking.
// In traditional runtime, setValue() and getValue() are always available (although their use is highly discouraged due to perf penalties)

/** @param {number} ptr
    @param {number} value
    @param {string} type
    @param {number|boolean=} noSafe */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

/** @param {number} ptr
    @param {string} type
    @param {number|boolean=} noSafe */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}





// Wasm globals

var wasmMemory;

// In fastcomp asm.js, we don't need a wasm Table at all.
// In the wasm backend, we polyfill the WebAssembly object,
// so this creates a (non-native-wasm) table for us.
var wasmTable = new WebAssembly.Table({
  'initial': 31,
  'maximum': 31 + 0,
  'element': 'anyfunc'
});


//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

// C calling interface.
/** @param {Array=} argTypes
    @param {Arguments|Array=} args
    @param {Object=} opts */
function ccall(ident, returnType, argTypes, args, opts) {
  // For fast lookup of conversion functions
  var toC = {
    'string': function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    },
    'array': function(arr) {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };

  function convertReturnValue(ret) {
    if (returnType === 'string') return UTF8ToString(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  assert(returnType !== 'array', 'Return type should not be "array".');
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);

  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  return ret;
}

/** @param {Array=} argTypes
    @param {Object=} opts */
function cwrap(ident, returnType, argTypes, opts) {
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc,
    stackAlloc,
    dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    assert(type, 'Must know what type to store in allocate!');

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}


// runtime_strings.js: Strings related runtime functions that are part of both MINIMAL_RUNTIME and regular runtime.

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte 0x' + u0.toString(16) + ' encountered when deserializing a UTF-8 string on the asm.js/wasm heap to a JS string!');
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u >= 0x200000) warnOnce('Invalid Unicode code point 0x' + u.toString(16) + ' encountered when serializing a JS string to an UTF-8 string on the asm.js/wasm heap! (Valid unicode code points should be in range 0-0x1FFFFF).');
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}



// runtime_strings_extra.js: Strings related runtime functions that are available only in regular runtime.

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAPU8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}

// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;

function UTF16ToString(ptr) {
  assert(ptr % 2 == 0, 'Pointer passed to UTF16ToString must be aligned to two bytes!');
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 2 == 0, 'Pointer passed to stringToUTF16 must be aligned to two bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  assert(ptr % 4 == 0, 'Pointer passed to UTF32ToString must be aligned to four bytes!');
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 4 == 0, 'Pointer passed to stringToUTF32 must be aligned to four bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated
    @param {boolean=} dontAddNull */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  assert(array.length >= 0, 'writeArrayToMemory array must have a length (should be an array or typed array)')
  HEAP8.set(array, buffer);
}

/** @param {boolean=} dontAddNull */
function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    assert(str.charCodeAt(i) === str.charCodeAt(i)&0xff);
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}



// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBufferAndViews(buf) {
  buffer = buf;
  Module['HEAP8'] = HEAP8 = new Int8Array(buf);
  Module['HEAP16'] = HEAP16 = new Int16Array(buf);
  Module['HEAP32'] = HEAP32 = new Int32Array(buf);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buf);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buf);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buf);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buf);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buf);
}

var STATIC_BASE = 1024,
    STACK_BASE = 5247488,
    STACKTOP = STACK_BASE,
    STACK_MAX = 4608,
    DYNAMIC_BASE = 5247488,
    DYNAMICTOP_PTR = 4448;

assert(STACK_BASE % 16 === 0, 'stack must start aligned');
assert(DYNAMIC_BASE % 16 === 0, 'heap must start aligned');



var TOTAL_STACK = 5242880;
if (Module['TOTAL_STACK']) assert(TOTAL_STACK === Module['TOTAL_STACK'], 'the stack size can no longer be determined at runtime')

var INITIAL_INITIAL_MEMORY = Module['INITIAL_MEMORY'] || 16777216;if (!Object.getOwnPropertyDescriptor(Module, 'INITIAL_MEMORY')) Object.defineProperty(Module, 'INITIAL_MEMORY', { configurable: true, get: function() { abort('Module.INITIAL_MEMORY has been replaced with plain INITIAL_INITIAL_MEMORY') } });

assert(INITIAL_INITIAL_MEMORY >= TOTAL_STACK, 'INITIAL_MEMORY should be larger than TOTAL_STACK, was ' + INITIAL_INITIAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');

// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && Int32Array.prototype.subarray !== undefined && Int32Array.prototype.set !== undefined,
       'JS engine does not provide full typed array support');






// In standalone mode, the wasm creates the memory, and the user can't provide it.
// In non-standalone/normal mode, we create the memory here.

// Create the main memory. (Note: this isn't used in STANDALONE_WASM mode since the wasm
// memory is created in the wasm, not in JS.)

  if (Module['wasmMemory']) {
    wasmMemory = Module['wasmMemory'];
  } else
  {
    wasmMemory = new WebAssembly.Memory({
      'initial': INITIAL_INITIAL_MEMORY / WASM_PAGE_SIZE
      ,
      'maximum': INITIAL_INITIAL_MEMORY / WASM_PAGE_SIZE
    });
  }


if (wasmMemory) {
  buffer = wasmMemory.buffer;
}

// If the user provides an incorrect length, just use that length instead rather than providing the user to
// specifically provide the memory length with Module['INITIAL_MEMORY'].
INITIAL_INITIAL_MEMORY = buffer.byteLength;
assert(INITIAL_INITIAL_MEMORY % WASM_PAGE_SIZE === 0);
updateGlobalBufferAndViews(buffer);

HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;




// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  assert((STACK_MAX & 3) == 0);
  // The stack grows downwards
  HEAPU32[(STACK_MAX >> 2)+1] = 0x2135467;
  HEAPU32[(STACK_MAX >> 2)+2] = 0x89BACDFE;
  // Also test the global address 0 for integrity.
  // We don't do this with ASan because ASan does its own checks for this.
  HEAP32[0] = 0x63736d65; /* 'emsc' */
}

function checkStackCookie() {
  var cookie1 = HEAPU32[(STACK_MAX >> 2)+1];
  var cookie2 = HEAPU32[(STACK_MAX >> 2)+2];
  if (cookie1 != 0x2135467 || cookie2 != 0x89BACDFE) {
    abort('Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x2135467, but received 0x' + cookie2.toString(16) + ' ' + cookie1.toString(16));
  }
  // Also test the global address 0 for integrity.
  // We don't do this with ASan because ASan does its own checks for this.
  if (HEAP32[0] !== 0x63736d65 /* 'emsc' */) abort('Runtime error: The application has corrupted its heap memory area (address zero)!');
}

function abortStackOverflow(allocSize) {
  abort('Stack overflow! Attempted to allocate ' + allocSize + ' bytes on the stack, but stack has only ' + (STACK_MAX - stackSave() + allocSize) + ' bytes available!');
}




// Endianness check (note: assumes compiler arch was little-endian)
(function() {
  var h16 = new Int16Array(1);
  var h8 = new Int8Array(h16.buffer);
  h16[0] = 0x6373;
  if (h8[0] !== 0x73 || h8[1] !== 0x63) throw 'Runtime error: expected the system to be little-endian!';
})();

function abortFnPtrError(ptr, sig) {
	abort("Invalid function pointer " + ptr + " called with signature '" + sig + "'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this). Build with ASSERTIONS=2 for more info.");
}



function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {

  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPRERUN__);
}

function initRuntime() {
  checkStackCookie();
  assert(!runtimeInitialized);
  runtimeInitialized = true;
  
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  checkStackCookie();
  
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  checkStackCookie();
  runtimeExited = true;
}

function postRun() {
  checkStackCookie();

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

/** @param {number|boolean=} ignore */
function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
/** @param {number|boolean=} ignore */
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/fround

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/trunc

assert(Math.imul, 'This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.fround, 'This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.clz32, 'This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.trunc, 'This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

function getUniqueRunDependency(id) {
  var orig = id;
  while (1) {
    if (!runDependencyTracking[id]) return id;
    id = orig + Math.random();
  }
}

function addRunDependency(id) {
  runDependencies++;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval !== 'undefined') {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(function() {
        if (ABORT) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
          return;
        }
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            err('still waiting on run dependencies:');
          }
          err('dependency: ' + dep);
        }
        if (shown) {
          err('(end of list)');
        }
      }, 10000);
    }
  } else {
    err('warning: run dependency added without ID');
  }
}

function removeRunDependency(id) {
  runDependencies--;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    err('warning: run dependency removed without ID');
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data


/** @param {string|number=} what */
function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  what += '';
  out(what);
  err(what);

  ABORT = true;
  EXITSTATUS = 1;

  var output = 'abort(' + what + ') at ' + stackTrace();
  what = output;

  // Throw a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  throw new WebAssembly.RuntimeError(what);
}


var memoryInitializer = null;





// show errors on likely calls to FS when it was not included
var FS = {
  error: function() {
    abort('Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with  -s FORCE_FILESYSTEM=1');
  },
  init: function() { FS.error() },
  createDataFile: function() { FS.error() },
  createPreloadedFile: function() { FS.error() },
  createLazyFile: function() { FS.error() },
  open: function() { FS.error() },
  mkdev: function() { FS.error() },
  registerDevice: function() { FS.error() },
  analyzePath: function() { FS.error() },
  loadFilesFromDB: function() { FS.error() },

  ErrnoError: function ErrnoError() { FS.error() },
};
Module['FS_createDataFile'] = FS.createDataFile;
Module['FS_createPreloadedFile'] = FS.createPreloadedFile;



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}




var wasmBinaryFile = 'function.wasm';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function getBinary() {
  try {
    if (wasmBinary) {
      return new Uint8Array(wasmBinary);
    }

    var binary = tryParseAsDataURI(wasmBinaryFile);
    if (binary) {
      return binary;
    }
    if (readBinary) {
      return readBinary(wasmBinaryFile);
    } else {
      throw "both async and sync fetching of the wasm failed";
    }
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise() {
  // if we don't have the binary yet, and have the Fetch api, use that
  // in some environments, like Electron's render process, Fetch api may be present, but have a different context than expected, let's only use it on the Web
  if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && typeof fetch === 'function') {
    return fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function(response) {
      if (!response['ok']) {
        throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
      }
      return response['arrayBuffer']();
    }).catch(function () {
      return getBinary();
    });
  }
  // Otherwise, getBinary should be able to get it synchronously
  return new Promise(function(resolve, reject) {
    resolve(getBinary());
  });
}



// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm() {
  // prepare imports
  var info = {
    'env': asmLibraryArg,
    'wasi_snapshot_preview1': asmLibraryArg
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/
  function receiveInstance(instance, module) {
    var exports = instance.exports;
    Module['asm'] = exports;
    removeRunDependency('wasm-instantiate');
  }
   // we can't run yet (except in a pthread, where we have a custom sync instantiator)
  addRunDependency('wasm-instantiate');


  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiatedSource(output) {
    // 'output' is a WebAssemblyInstantiatedSource object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
      // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
      // When the regression is fixed, can restore the above USE_PTHREADS-enabled path.
    receiveInstance(output['instance']);
  }


  function instantiateArrayBuffer(receiver) {
    return getBinaryPromise().then(function(binary) {
      return WebAssembly.instantiate(binary, info);
    }).then(receiver, function(reason) {
      err('failed to asynchronously prepare wasm: ' + reason);
      abort(reason);
    });
  }

  // Prefer streaming instantiation if available.
  function instantiateAsync() {
    if (!wasmBinary &&
        typeof WebAssembly.instantiateStreaming === 'function' &&
        !isDataURI(wasmBinaryFile) &&
        typeof fetch === 'function') {
      fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function (response) {
        var result = WebAssembly.instantiateStreaming(response, info);
        return result.then(receiveInstantiatedSource, function(reason) {
            // We expect the most common failure cause to be a bad MIME type for the binary,
            // in which case falling back to ArrayBuffer instantiation should work.
            err('wasm streaming compile failed: ' + reason);
            err('falling back to ArrayBuffer instantiation');
            instantiateArrayBuffer(receiveInstantiatedSource);
          });
      });
    } else {
      return instantiateArrayBuffer(receiveInstantiatedSource);
    }
  }
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to run the instantiation parallel
  // to any other async startup actions they are performing.
  if (Module['instantiateWasm']) {
    try {
      var exports = Module['instantiateWasm'](info, receiveInstance);
      return exports;
    } catch(e) {
      err('Module.instantiateWasm callback failed with error: ' + e);
      return false;
    }
  }

  instantiateAsync();
  return {}; // no exports yet; we'll fill them in later
}


// Globals used by JS i64 conversions
var tempDouble;
var tempI64;

// === Body ===

var ASM_CONSTS = {
  
};




// STATICTOP = STATIC_BASE + 3584;
/* global initializers */  __ATINIT__.push({ func: function() { ___wasm_call_ctors() } });




/* no memory initializer */
// {{PRE_LIBRARY}}


  function demangle(func) {
      warnOnce('warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling');
      return func;
    }

  function demangleAll(text) {
      var regex =
        /\b_Z[\w\d_]+/g;
      return text.replace(regex,
        function(x) {
          var y = demangle(x);
          return x === y ? x : (y + ' [' + x + ']');
        });
    }

  function jsStackTrace() {
      var err = new Error();
      if (!err.stack) {
        // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
        // so try that as a special-case.
        try {
          throw new Error();
        } catch(e) {
          err = e;
        }
        if (!err.stack) {
          return '(no stack trace available)';
        }
      }
      return err.stack.toString();
    }

  function stackTrace() {
      var js = jsStackTrace();
      if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
      return demangleAll(js);
    }

  function ___handle_stack_overflow() {
      abort('stack overflow')
    }

  
  function getShiftFromSize(size) {
      switch (size) {
          case 1: return 0;
          case 2: return 1;
          case 4: return 2;
          case 8: return 3;
          default:
              throw new TypeError('Unknown type size: ' + size);
      }
    }
  
  
  
  function embind_init_charCodes() {
      var codes = new Array(256);
      for (var i = 0; i < 256; ++i) {
          codes[i] = String.fromCharCode(i);
      }
      embind_charCodes = codes;
    }var embind_charCodes=undefined;function readLatin1String(ptr) {
      var ret = "";
      var c = ptr;
      while (HEAPU8[c]) {
          ret += embind_charCodes[HEAPU8[c++]];
      }
      return ret;
    }
  
  
  var awaitingDependencies={};
  
  var registeredTypes={};
  
  var typeDependencies={};
  
  
  
  
  
  
  var char_0=48;
  
  var char_9=57;function makeLegalFunctionName(name) {
      if (undefined === name) {
          return '_unknown';
      }
      name = name.replace(/[^a-zA-Z0-9_]/g, '$');
      var f = name.charCodeAt(0);
      if (f >= char_0 && f <= char_9) {
          return '_' + name;
      } else {
          return name;
      }
    }function createNamedFunction(name, body) {
      name = makeLegalFunctionName(name);
      /*jshint evil:true*/
      return new Function(
          "body",
          "return function " + name + "() {\n" +
          "    \"use strict\";" +
          "    return body.apply(this, arguments);\n" +
          "};\n"
      )(body);
    }function extendError(baseErrorType, errorName) {
      var errorClass = createNamedFunction(errorName, function(message) {
          this.name = errorName;
          this.message = message;
  
          var stack = (new Error(message)).stack;
          if (stack !== undefined) {
              this.stack = this.toString() + '\n' +
                  stack.replace(/^Error(:[^\n]*)?\n/, '');
          }
      });
      errorClass.prototype = Object.create(baseErrorType.prototype);
      errorClass.prototype.constructor = errorClass;
      errorClass.prototype.toString = function() {
          if (this.message === undefined) {
              return this.name;
          } else {
              return this.name + ': ' + this.message;
          }
      };
  
      return errorClass;
    }var BindingError=undefined;function throwBindingError(message) {
      throw new BindingError(message);
    }
  
  
  
  var InternalError=undefined;function throwInternalError(message) {
      throw new InternalError(message);
    }function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
      myTypes.forEach(function(type) {
          typeDependencies[type] = dependentTypes;
      });
  
      function onComplete(typeConverters) {
          var myTypeConverters = getTypeConverters(typeConverters);
          if (myTypeConverters.length !== myTypes.length) {
              throwInternalError('Mismatched type converter count');
          }
          for (var i = 0; i < myTypes.length; ++i) {
              registerType(myTypes[i], myTypeConverters[i]);
          }
      }
  
      var typeConverters = new Array(dependentTypes.length);
      var unregisteredTypes = [];
      var registered = 0;
      dependentTypes.forEach(function(dt, i) {
          if (registeredTypes.hasOwnProperty(dt)) {
              typeConverters[i] = registeredTypes[dt];
          } else {
              unregisteredTypes.push(dt);
              if (!awaitingDependencies.hasOwnProperty(dt)) {
                  awaitingDependencies[dt] = [];
              }
              awaitingDependencies[dt].push(function() {
                  typeConverters[i] = registeredTypes[dt];
                  ++registered;
                  if (registered === unregisteredTypes.length) {
                      onComplete(typeConverters);
                  }
              });
          }
      });
      if (0 === unregisteredTypes.length) {
          onComplete(typeConverters);
      }
    }/** @param {Object=} options */
  function registerType(rawType, registeredInstance, options) {
      options = options || {};
  
      if (!('argPackAdvance' in registeredInstance)) {
          throw new TypeError('registerType registeredInstance requires argPackAdvance');
      }
  
      var name = registeredInstance.name;
      if (!rawType) {
          throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
      }
      if (registeredTypes.hasOwnProperty(rawType)) {
          if (options.ignoreDuplicateRegistrations) {
              return;
          } else {
              throwBindingError("Cannot register type '" + name + "' twice");
          }
      }
  
      registeredTypes[rawType] = registeredInstance;
      delete typeDependencies[rawType];
  
      if (awaitingDependencies.hasOwnProperty(rawType)) {
          var callbacks = awaitingDependencies[rawType];
          delete awaitingDependencies[rawType];
          callbacks.forEach(function(cb) {
              cb();
          });
      }
    }function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
      var shift = getShiftFromSize(size);
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(wt) {
              // ambiguous emscripten ABI: sometimes return values are
              // true or false, and sometimes integers (0 or 1)
              return !!wt;
          },
          'toWireType': function(destructors, o) {
              return o ? trueValue : falseValue;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': function(pointer) {
              // TODO: if heap is fixed (like in asm.js) this could be executed outside
              var heap;
              if (size === 1) {
                  heap = HEAP8;
              } else if (size === 2) {
                  heap = HEAP16;
              } else if (size === 4) {
                  heap = HEAP32;
              } else {
                  throw new TypeError("Unknown boolean type size: " + name);
              }
              return this['fromWireType'](heap[pointer >> shift]);
          },
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  
  
  function ClassHandle_isAliasOf(other) {
      if (!(this instanceof ClassHandle)) {
          return false;
      }
      if (!(other instanceof ClassHandle)) {
          return false;
      }
  
      var leftClass = this.$$.ptrType.registeredClass;
      var left = this.$$.ptr;
      var rightClass = other.$$.ptrType.registeredClass;
      var right = other.$$.ptr;
  
      while (leftClass.baseClass) {
          left = leftClass.upcast(left);
          leftClass = leftClass.baseClass;
      }
  
      while (rightClass.baseClass) {
          right = rightClass.upcast(right);
          rightClass = rightClass.baseClass;
      }
  
      return leftClass === rightClass && left === right;
    }
  
  
  function shallowCopyInternalPointer(o) {
      return {
          count: o.count,
          deleteScheduled: o.deleteScheduled,
          preservePointerOnDelete: o.preservePointerOnDelete,
          ptr: o.ptr,
          ptrType: o.ptrType,
          smartPtr: o.smartPtr,
          smartPtrType: o.smartPtrType,
      };
    }
  
  function throwInstanceAlreadyDeleted(obj) {
      function getInstanceTypeName(handle) {
        return handle.$$.ptrType.registeredClass.name;
      }
      throwBindingError(getInstanceTypeName(obj) + ' instance already deleted');
    }
  
  
  var finalizationGroup=false;
  
  function detachFinalizer(handle) {}
  
  
  function runDestructor($$) {
      if ($$.smartPtr) {
          $$.smartPtrType.rawDestructor($$.smartPtr);
      } else {
          $$.ptrType.registeredClass.rawDestructor($$.ptr);
      }
    }function releaseClassHandle($$) {
      $$.count.value -= 1;
      var toDelete = 0 === $$.count.value;
      if (toDelete) {
          runDestructor($$);
      }
    }function attachFinalizer(handle) {
      if ('undefined' === typeof FinalizationGroup) {
          attachFinalizer = function (handle) { return handle; };
          return handle;
      }
      // If the running environment has a FinalizationGroup (see
      // https://github.com/tc39/proposal-weakrefs), then attach finalizers
      // for class handles.  We check for the presence of FinalizationGroup
      // at run-time, not build-time.
      finalizationGroup = new FinalizationGroup(function (iter) {
          for (var result = iter.next(); !result.done; result = iter.next()) {
              var $$ = result.value;
              if (!$$.ptr) {
                  console.warn('object already deleted: ' + $$.ptr);
              } else {
                  releaseClassHandle($$);
              }
          }
      });
      attachFinalizer = function(handle) {
          finalizationGroup.register(handle, handle.$$, handle.$$);
          return handle;
      };
      detachFinalizer = function(handle) {
          finalizationGroup.unregister(handle.$$);
      };
      return attachFinalizer(handle);
    }function ClassHandle_clone() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
  
      if (this.$$.preservePointerOnDelete) {
          this.$$.count.value += 1;
          return this;
      } else {
          var clone = attachFinalizer(Object.create(Object.getPrototypeOf(this), {
              $$: {
                  value: shallowCopyInternalPointer(this.$$),
              }
          }));
  
          clone.$$.count.value += 1;
          clone.$$.deleteScheduled = false;
          return clone;
      }
    }
  
  function ClassHandle_delete() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
  
      if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
      }
  
      detachFinalizer(this);
      releaseClassHandle(this.$$);
  
      if (!this.$$.preservePointerOnDelete) {
          this.$$.smartPtr = undefined;
          this.$$.ptr = undefined;
      }
    }
  
  function ClassHandle_isDeleted() {
      return !this.$$.ptr;
    }
  
  
  var delayFunction=undefined;
  
  var deletionQueue=[];
  
  function flushPendingDeletes() {
      while (deletionQueue.length) {
          var obj = deletionQueue.pop();
          obj.$$.deleteScheduled = false;
          obj['delete']();
      }
    }function ClassHandle_deleteLater() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
      if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
      }
      deletionQueue.push(this);
      if (deletionQueue.length === 1 && delayFunction) {
          delayFunction(flushPendingDeletes);
      }
      this.$$.deleteScheduled = true;
      return this;
    }function init_ClassHandle() {
      ClassHandle.prototype['isAliasOf'] = ClassHandle_isAliasOf;
      ClassHandle.prototype['clone'] = ClassHandle_clone;
      ClassHandle.prototype['delete'] = ClassHandle_delete;
      ClassHandle.prototype['isDeleted'] = ClassHandle_isDeleted;
      ClassHandle.prototype['deleteLater'] = ClassHandle_deleteLater;
    }function ClassHandle() {
    }
  
  var registeredPointers={};
  
  
  function ensureOverloadTable(proto, methodName, humanName) {
      if (undefined === proto[methodName].overloadTable) {
          var prevFunc = proto[methodName];
          // Inject an overload resolver function that routes to the appropriate overload based on the number of arguments.
          proto[methodName] = function() {
              // TODO This check can be removed in -O3 level "unsafe" optimizations.
              if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
                  throwBindingError("Function '" + humanName + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + proto[methodName].overloadTable + ")!");
              }
              return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
          };
          // Move the previous function into the overload table.
          proto[methodName].overloadTable = [];
          proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
      }
    }/** @param {number=} numArguments */
  function exposePublicSymbol(name, value, numArguments) {
      if (Module.hasOwnProperty(name)) {
          if (undefined === numArguments || (undefined !== Module[name].overloadTable && undefined !== Module[name].overloadTable[numArguments])) {
              throwBindingError("Cannot register public name '" + name + "' twice");
          }
  
          // We are exposing a function with the same name as an existing function. Create an overload table and a function selector
          // that routes between the two.
          ensureOverloadTable(Module, name, name);
          if (Module.hasOwnProperty(numArguments)) {
              throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + numArguments + ")!");
          }
          // Add the new function into the overload table.
          Module[name].overloadTable[numArguments] = value;
      }
      else {
          Module[name] = value;
          if (undefined !== numArguments) {
              Module[name].numArguments = numArguments;
          }
      }
    }
  
  /** @constructor */
  function RegisteredClass(
      name,
      constructor,
      instancePrototype,
      rawDestructor,
      baseClass,
      getActualType,
      upcast,
      downcast
    ) {
      this.name = name;
      this.constructor = constructor;
      this.instancePrototype = instancePrototype;
      this.rawDestructor = rawDestructor;
      this.baseClass = baseClass;
      this.getActualType = getActualType;
      this.upcast = upcast;
      this.downcast = downcast;
      this.pureVirtualFunctions = [];
    }
  
  
  
  function upcastPointer(ptr, ptrClass, desiredClass) {
      while (ptrClass !== desiredClass) {
          if (!ptrClass.upcast) {
              throwBindingError("Expected null or instance of " + desiredClass.name + ", got an instance of " + ptrClass.name);
          }
          ptr = ptrClass.upcast(ptr);
          ptrClass = ptrClass.baseClass;
      }
      return ptr;
    }function constNoSmartPtrRawPointerToWireType(destructors, handle) {
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
          return 0;
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
      return ptr;
    }
  
  function genericPointerToWireType(destructors, handle) {
      var ptr;
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
  
          if (this.isSmartPointer) {
              ptr = this.rawConstructor();
              if (destructors !== null) {
                  destructors.push(this.rawDestructor, ptr);
              }
              return ptr;
          } else {
              return 0;
          }
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      if (!this.isConst && handle.$$.ptrType.isConst) {
          throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
  
      if (this.isSmartPointer) {
          // TODO: this is not strictly true
          // We could support BY_EMVAL conversions from raw pointers to smart pointers
          // because the smart pointer can hold a reference to the handle
          if (undefined === handle.$$.smartPtr) {
              throwBindingError('Passing raw pointer to smart pointer is illegal');
          }
  
          switch (this.sharingPolicy) {
              case 0: // NONE
                  // no upcasting
                  if (handle.$$.smartPtrType === this) {
                      ptr = handle.$$.smartPtr;
                  } else {
                      throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
                  }
                  break;
  
              case 1: // INTRUSIVE
                  ptr = handle.$$.smartPtr;
                  break;
  
              case 2: // BY_EMVAL
                  if (handle.$$.smartPtrType === this) {
                      ptr = handle.$$.smartPtr;
                  } else {
                      var clonedHandle = handle['clone']();
                      ptr = this.rawShare(
                          ptr,
                          __emval_register(function() {
                              clonedHandle['delete']();
                          })
                      );
                      if (destructors !== null) {
                          destructors.push(this.rawDestructor, ptr);
                      }
                  }
                  break;
  
              default:
                  throwBindingError('Unsupporting sharing policy');
          }
      }
      return ptr;
    }
  
  function nonConstNoSmartPtrRawPointerToWireType(destructors, handle) {
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
          return 0;
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      if (handle.$$.ptrType.isConst) {
          throwBindingError('Cannot convert argument of type ' + handle.$$.ptrType.name + ' to parameter type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
      return ptr;
    }
  
  
  function simpleReadValueFromPointer(pointer) {
      return this['fromWireType'](HEAPU32[pointer >> 2]);
    }
  
  function RegisteredPointer_getPointee(ptr) {
      if (this.rawGetPointee) {
          ptr = this.rawGetPointee(ptr);
      }
      return ptr;
    }
  
  function RegisteredPointer_destructor(ptr) {
      if (this.rawDestructor) {
          this.rawDestructor(ptr);
      }
    }
  
  function RegisteredPointer_deleteObject(handle) {
      if (handle !== null) {
          handle['delete']();
      }
    }
  
  
  function downcastPointer(ptr, ptrClass, desiredClass) {
      if (ptrClass === desiredClass) {
          return ptr;
      }
      if (undefined === desiredClass.baseClass) {
          return null; // no conversion
      }
  
      var rv = downcastPointer(ptr, ptrClass, desiredClass.baseClass);
      if (rv === null) {
          return null;
      }
      return desiredClass.downcast(rv);
    }
  
  
  
  
  function getInheritedInstanceCount() {
      return Object.keys(registeredInstances).length;
    }
  
  function getLiveInheritedInstances() {
      var rv = [];
      for (var k in registeredInstances) {
          if (registeredInstances.hasOwnProperty(k)) {
              rv.push(registeredInstances[k]);
          }
      }
      return rv;
    }
  
  function setDelayFunction(fn) {
      delayFunction = fn;
      if (deletionQueue.length && delayFunction) {
          delayFunction(flushPendingDeletes);
      }
    }function init_embind() {
      Module['getInheritedInstanceCount'] = getInheritedInstanceCount;
      Module['getLiveInheritedInstances'] = getLiveInheritedInstances;
      Module['flushPendingDeletes'] = flushPendingDeletes;
      Module['setDelayFunction'] = setDelayFunction;
    }var registeredInstances={};
  
  function getBasestPointer(class_, ptr) {
      if (ptr === undefined) {
          throwBindingError('ptr should not be undefined');
      }
      while (class_.baseClass) {
          ptr = class_.upcast(ptr);
          class_ = class_.baseClass;
      }
      return ptr;
    }function getInheritedInstance(class_, ptr) {
      ptr = getBasestPointer(class_, ptr);
      return registeredInstances[ptr];
    }
  
  function makeClassHandle(prototype, record) {
      if (!record.ptrType || !record.ptr) {
          throwInternalError('makeClassHandle requires ptr and ptrType');
      }
      var hasSmartPtrType = !!record.smartPtrType;
      var hasSmartPtr = !!record.smartPtr;
      if (hasSmartPtrType !== hasSmartPtr) {
          throwInternalError('Both smartPtrType and smartPtr must be specified');
      }
      record.count = { value: 1 };
      return attachFinalizer(Object.create(prototype, {
          $$: {
              value: record,
          },
      }));
    }function RegisteredPointer_fromWireType(ptr) {
      // ptr is a raw pointer (or a raw smartpointer)
  
      // rawPointer is a maybe-null raw pointer
      var rawPointer = this.getPointee(ptr);
      if (!rawPointer) {
          this.destructor(ptr);
          return null;
      }
  
      var registeredInstance = getInheritedInstance(this.registeredClass, rawPointer);
      if (undefined !== registeredInstance) {
          // JS object has been neutered, time to repopulate it
          if (0 === registeredInstance.$$.count.value) {
              registeredInstance.$$.ptr = rawPointer;
              registeredInstance.$$.smartPtr = ptr;
              return registeredInstance['clone']();
          } else {
              // else, just increment reference count on existing object
              // it already has a reference to the smart pointer
              var rv = registeredInstance['clone']();
              this.destructor(ptr);
              return rv;
          }
      }
  
      function makeDefaultHandle() {
          if (this.isSmartPointer) {
              return makeClassHandle(this.registeredClass.instancePrototype, {
                  ptrType: this.pointeeType,
                  ptr: rawPointer,
                  smartPtrType: this,
                  smartPtr: ptr,
              });
          } else {
              return makeClassHandle(this.registeredClass.instancePrototype, {
                  ptrType: this,
                  ptr: ptr,
              });
          }
      }
  
      var actualType = this.registeredClass.getActualType(rawPointer);
      var registeredPointerRecord = registeredPointers[actualType];
      if (!registeredPointerRecord) {
          return makeDefaultHandle.call(this);
      }
  
      var toType;
      if (this.isConst) {
          toType = registeredPointerRecord.constPointerType;
      } else {
          toType = registeredPointerRecord.pointerType;
      }
      var dp = downcastPointer(
          rawPointer,
          this.registeredClass,
          toType.registeredClass);
      if (dp === null) {
          return makeDefaultHandle.call(this);
      }
      if (this.isSmartPointer) {
          return makeClassHandle(toType.registeredClass.instancePrototype, {
              ptrType: toType,
              ptr: dp,
              smartPtrType: this,
              smartPtr: ptr,
          });
      } else {
          return makeClassHandle(toType.registeredClass.instancePrototype, {
              ptrType: toType,
              ptr: dp,
          });
      }
    }function init_RegisteredPointer() {
      RegisteredPointer.prototype.getPointee = RegisteredPointer_getPointee;
      RegisteredPointer.prototype.destructor = RegisteredPointer_destructor;
      RegisteredPointer.prototype['argPackAdvance'] = 8;
      RegisteredPointer.prototype['readValueFromPointer'] = simpleReadValueFromPointer;
      RegisteredPointer.prototype['deleteObject'] = RegisteredPointer_deleteObject;
      RegisteredPointer.prototype['fromWireType'] = RegisteredPointer_fromWireType;
    }/** @constructor
      @param {*=} pointeeType,
      @param {*=} sharingPolicy,
      @param {*=} rawGetPointee,
      @param {*=} rawConstructor,
      @param {*=} rawShare,
      @param {*=} rawDestructor,
       */
  function RegisteredPointer(
      name,
      registeredClass,
      isReference,
      isConst,
  
      // smart pointer properties
      isSmartPointer,
      pointeeType,
      sharingPolicy,
      rawGetPointee,
      rawConstructor,
      rawShare,
      rawDestructor
    ) {
      this.name = name;
      this.registeredClass = registeredClass;
      this.isReference = isReference;
      this.isConst = isConst;
  
      // smart pointer properties
      this.isSmartPointer = isSmartPointer;
      this.pointeeType = pointeeType;
      this.sharingPolicy = sharingPolicy;
      this.rawGetPointee = rawGetPointee;
      this.rawConstructor = rawConstructor;
      this.rawShare = rawShare;
      this.rawDestructor = rawDestructor;
  
      if (!isSmartPointer && registeredClass.baseClass === undefined) {
          if (isConst) {
              this['toWireType'] = constNoSmartPtrRawPointerToWireType;
              this.destructorFunction = null;
          } else {
              this['toWireType'] = nonConstNoSmartPtrRawPointerToWireType;
              this.destructorFunction = null;
          }
      } else {
          this['toWireType'] = genericPointerToWireType;
          // Here we must leave this.destructorFunction undefined, since whether genericPointerToWireType returns
          // a pointer that needs to be freed up is runtime-dependent, and cannot be evaluated at registration time.
          // TODO: Create an alternative mechanism that allows removing the use of var destructors = []; array in
          //       craftInvokerFunction altogether.
      }
    }
  
  /** @param {number=} numArguments */
  function replacePublicSymbol(name, value, numArguments) {
      if (!Module.hasOwnProperty(name)) {
          throwInternalError('Replacing nonexistant public symbol');
      }
      // If there's an overload table for this symbol, replace the symbol in the overload table instead.
      if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
          Module[name].overloadTable[numArguments] = value;
      }
      else {
          Module[name] = value;
          Module[name].argCount = numArguments;
      }
    }
  
  function embind__requireFunction(signature, rawFunction) {
      signature = readLatin1String(signature);
  
      function makeDynCaller(dynCall) {
          var args = [];
          for (var i = 1; i < signature.length; ++i) {
              args.push('a' + i);
          }
  
          var name = 'dynCall_' + signature + '_' + rawFunction;
          var body = 'return function ' + name + '(' + args.join(', ') + ') {\n';
          body    += '    return dynCall(rawFunction' + (args.length ? ', ' : '') + args.join(', ') + ');\n';
          body    += '};\n';
  
          return (new Function('dynCall', 'rawFunction', body))(dynCall, rawFunction);
      }
  
      var dc = Module['dynCall_' + signature];
      var fp = makeDynCaller(dc);
  
      if (typeof fp !== "function") {
          throwBindingError("unknown function pointer with signature " + signature + ": " + rawFunction);
      }
      return fp;
    }
  
  
  var UnboundTypeError=undefined;
  
  function getTypeName(type) {
      var ptr = ___getTypeName(type);
      var rv = readLatin1String(ptr);
      _free(ptr);
      return rv;
    }function throwUnboundTypeError(message, types) {
      var unboundTypes = [];
      var seen = {};
      function visit(type) {
          if (seen[type]) {
              return;
          }
          if (registeredTypes[type]) {
              return;
          }
          if (typeDependencies[type]) {
              typeDependencies[type].forEach(visit);
              return;
          }
          unboundTypes.push(type);
          seen[type] = true;
      }
      types.forEach(visit);
  
      throw new UnboundTypeError(message + ': ' + unboundTypes.map(getTypeName).join([', ']));
    }function __embind_register_class(
      rawType,
      rawPointerType,
      rawConstPointerType,
      baseClassRawType,
      getActualTypeSignature,
      getActualType,
      upcastSignature,
      upcast,
      downcastSignature,
      downcast,
      name,
      destructorSignature,
      rawDestructor
    ) {
      name = readLatin1String(name);
      getActualType = embind__requireFunction(getActualTypeSignature, getActualType);
      if (upcast) {
          upcast = embind__requireFunction(upcastSignature, upcast);
      }
      if (downcast) {
          downcast = embind__requireFunction(downcastSignature, downcast);
      }
      rawDestructor = embind__requireFunction(destructorSignature, rawDestructor);
      var legalFunctionName = makeLegalFunctionName(name);
  
      exposePublicSymbol(legalFunctionName, function() {
          // this code cannot run if baseClassRawType is zero
          throwUnboundTypeError('Cannot construct ' + name + ' due to unbound types', [baseClassRawType]);
      });
  
      whenDependentTypesAreResolved(
          [rawType, rawPointerType, rawConstPointerType],
          baseClassRawType ? [baseClassRawType] : [],
          function(base) {
              base = base[0];
  
              var baseClass;
              var basePrototype;
              if (baseClassRawType) {
                  baseClass = base.registeredClass;
                  basePrototype = baseClass.instancePrototype;
              } else {
                  basePrototype = ClassHandle.prototype;
              }
  
              var constructor = createNamedFunction(legalFunctionName, function() {
                  if (Object.getPrototypeOf(this) !== instancePrototype) {
                      throw new BindingError("Use 'new' to construct " + name);
                  }
                  if (undefined === registeredClass.constructor_body) {
                      throw new BindingError(name + " has no accessible constructor");
                  }
                  var body = registeredClass.constructor_body[arguments.length];
                  if (undefined === body) {
                      throw new BindingError("Tried to invoke ctor of " + name + " with invalid number of parameters (" + arguments.length + ") - expected (" + Object.keys(registeredClass.constructor_body).toString() + ") parameters instead!");
                  }
                  return body.apply(this, arguments);
              });
  
              var instancePrototype = Object.create(basePrototype, {
                  constructor: { value: constructor },
              });
  
              constructor.prototype = instancePrototype;
  
              var registeredClass = new RegisteredClass(
                  name,
                  constructor,
                  instancePrototype,
                  rawDestructor,
                  baseClass,
                  getActualType,
                  upcast,
                  downcast);
  
              var referenceConverter = new RegisteredPointer(
                  name,
                  registeredClass,
                  true,
                  false,
                  false);
  
              var pointerConverter = new RegisteredPointer(
                  name + '*',
                  registeredClass,
                  false,
                  false,
                  false);
  
              var constPointerConverter = new RegisteredPointer(
                  name + ' const*',
                  registeredClass,
                  false,
                  true,
                  false);
  
              registeredPointers[rawType] = {
                  pointerType: pointerConverter,
                  constPointerType: constPointerConverter
              };
  
              replacePublicSymbol(legalFunctionName, constructor);
  
              return [referenceConverter, pointerConverter, constPointerConverter];
          }
      );
    }

  
  function heap32VectorToArray(count, firstElement) {
      var array = [];
      for (var i = 0; i < count; i++) {
          array.push(HEAP32[(firstElement >> 2) + i]);
      }
      return array;
    }
  
  function runDestructors(destructors) {
      while (destructors.length) {
          var ptr = destructors.pop();
          var del = destructors.pop();
          del(ptr);
      }
    }function __embind_register_class_constructor(
      rawClassType,
      argCount,
      rawArgTypesAddr,
      invokerSignature,
      invoker,
      rawConstructor
    ) {
      assert(argCount > 0);
      var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
      invoker = embind__requireFunction(invokerSignature, invoker);
      var args = [rawConstructor];
      var destructors = [];
  
      whenDependentTypesAreResolved([], [rawClassType], function(classType) {
          classType = classType[0];
          var humanName = 'constructor ' + classType.name;
  
          if (undefined === classType.registeredClass.constructor_body) {
              classType.registeredClass.constructor_body = [];
          }
          if (undefined !== classType.registeredClass.constructor_body[argCount - 1]) {
              throw new BindingError("Cannot register multiple constructors with identical number of parameters (" + (argCount-1) + ") for class '" + classType.name + "'! Overload resolution is currently only performed using the parameter count, not actual type info!");
          }
          classType.registeredClass.constructor_body[argCount - 1] = function unboundTypeHandler() {
              throwUnboundTypeError('Cannot construct ' + classType.name + ' due to unbound types', rawArgTypes);
          };
  
          whenDependentTypesAreResolved([], rawArgTypes, function(argTypes) {
              classType.registeredClass.constructor_body[argCount - 1] = function constructor_body() {
                  if (arguments.length !== argCount - 1) {
                      throwBindingError(humanName + ' called with ' + arguments.length + ' arguments, expected ' + (argCount-1));
                  }
                  destructors.length = 0;
                  args.length = argCount;
                  for (var i = 1; i < argCount; ++i) {
                      args[i] = argTypes[i]['toWireType'](destructors, arguments[i - 1]);
                  }
  
                  var ptr = invoker.apply(null, args);
                  runDestructors(destructors);
  
                  return argTypes[0]['fromWireType'](ptr);
              };
              return [];
          });
          return [];
      });
    }

  
  function validateThis(this_, classType, humanName) {
      if (!(this_ instanceof Object)) {
          throwBindingError(humanName + ' with invalid "this": ' + this_);
      }
      if (!(this_ instanceof classType.registeredClass.constructor)) {
          throwBindingError(humanName + ' incompatible with "this" of type ' + this_.constructor.name);
      }
      if (!this_.$$.ptr) {
          throwBindingError('cannot call emscripten binding method ' + humanName + ' on deleted object');
      }
  
      // todo: kill this
      return upcastPointer(
          this_.$$.ptr,
          this_.$$.ptrType.registeredClass,
          classType.registeredClass);
    }function __embind_register_class_property(
      classType,
      fieldName,
      getterReturnType,
      getterSignature,
      getter,
      getterContext,
      setterArgumentType,
      setterSignature,
      setter,
      setterContext
    ) {
      fieldName = readLatin1String(fieldName);
      getter = embind__requireFunction(getterSignature, getter);
  
      whenDependentTypesAreResolved([], [classType], function(classType) {
          classType = classType[0];
          var humanName = classType.name + '.' + fieldName;
          var desc = {
              get: function() {
                  throwUnboundTypeError('Cannot access ' + humanName + ' due to unbound types', [getterReturnType, setterArgumentType]);
              },
              enumerable: true,
              configurable: true
          };
          if (setter) {
              desc.set = function() {
                  throwUnboundTypeError('Cannot access ' + humanName + ' due to unbound types', [getterReturnType, setterArgumentType]);
              };
          } else {
              desc.set = function(v) {
                  throwBindingError(humanName + ' is a read-only property');
              };
          }
  
          Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
  
          whenDependentTypesAreResolved(
              [],
              (setter ? [getterReturnType, setterArgumentType] : [getterReturnType]),
          function(types) {
              var getterReturnType = types[0];
              var desc = {
                  get: function() {
                      var ptr = validateThis(this, classType, humanName + ' getter');
                      return getterReturnType['fromWireType'](getter(getterContext, ptr));
                  },
                  enumerable: true
              };
  
              if (setter) {
                  setter = embind__requireFunction(setterSignature, setter);
                  var setterArgumentType = types[1];
                  desc.set = function(v) {
                      var ptr = validateThis(this, classType, humanName + ' setter');
                      var destructors = [];
                      setter(setterContext, ptr, setterArgumentType['toWireType'](destructors, v));
                      runDestructors(destructors);
                  };
              }
  
              Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
              return [];
          });
  
          return [];
      });
    }

  
  
  var emval_free_list=[];
  
  var emval_handle_array=[{},{value:undefined},{value:null},{value:true},{value:false}];function __emval_decref(handle) {
      if (handle > 4 && 0 === --emval_handle_array[handle].refcount) {
          emval_handle_array[handle] = undefined;
          emval_free_list.push(handle);
      }
    }
  
  
  
  function count_emval_handles() {
      var count = 0;
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              ++count;
          }
      }
      return count;
    }
  
  function get_first_emval() {
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              return emval_handle_array[i];
          }
      }
      return null;
    }function init_emval() {
      Module['count_emval_handles'] = count_emval_handles;
      Module['get_first_emval'] = get_first_emval;
    }function __emval_register(value) {
  
      switch(value){
        case undefined :{ return 1; }
        case null :{ return 2; }
        case true :{ return 3; }
        case false :{ return 4; }
        default:{
          var handle = emval_free_list.length ?
              emval_free_list.pop() :
              emval_handle_array.length;
  
          emval_handle_array[handle] = {refcount: 1, value: value};
          return handle;
          }
        }
    }function __embind_register_emval(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(handle) {
              var rv = emval_handle_array[handle].value;
              __emval_decref(handle);
              return rv;
          },
          'toWireType': function(destructors, value) {
              return __emval_register(value);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: null, // This type does not need a destructor
  
          // TODO: do we need a deleteObject here?  write a test where
          // emval is passed into JS via an interface
      });
    }

  
  function _embind_repr(v) {
      if (v === null) {
          return 'null';
      }
      var t = typeof v;
      if (t === 'object' || t === 'array' || t === 'function') {
          return v.toString();
      } else {
          return '' + v;
      }
    }
  
  function floatReadValueFromPointer(name, shift) {
      switch (shift) {
          case 2: return function(pointer) {
              return this['fromWireType'](HEAPF32[pointer >> 2]);
          };
          case 3: return function(pointer) {
              return this['fromWireType'](HEAPF64[pointer >> 3]);
          };
          default:
              throw new TypeError("Unknown float type: " + name);
      }
    }function __embind_register_float(rawType, name, size) {
      var shift = getShiftFromSize(size);
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              return value;
          },
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following if() and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              return value;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': floatReadValueFromPointer(name, shift),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  
  function new_(constructor, argumentList) {
      if (!(constructor instanceof Function)) {
          throw new TypeError('new_ called with constructor type ' + typeof(constructor) + " which is not a function");
      }
  
      /*
       * Previously, the following line was just:
  
       function dummy() {};
  
       * Unfortunately, Chrome was preserving 'dummy' as the object's name, even though at creation, the 'dummy' has the
       * correct constructor name.  Thus, objects created with IMVU.new would show up in the debugger as 'dummy', which
       * isn't very helpful.  Using IMVU.createNamedFunction addresses the issue.  Doublely-unfortunately, there's no way
       * to write a test for this behavior.  -NRD 2013.02.22
       */
      var dummy = createNamedFunction(constructor.name || 'unknownFunctionName', function(){});
      dummy.prototype = constructor.prototype;
      var obj = new dummy;
  
      var r = constructor.apply(obj, argumentList);
      return (r instanceof Object) ? r : obj;
    }function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
      // humanName: a human-readable string name for the function to be generated.
      // argTypes: An array that contains the embind type objects for all types in the function signature.
      //    argTypes[0] is the type object for the function return value.
      //    argTypes[1] is the type object for function this object/class type, or null if not crafting an invoker for a class method.
      //    argTypes[2...] are the actual function parameters.
      // classType: The embind type object for the class to be bound, or null if this is not a method of a class.
      // cppInvokerFunc: JS Function object to the C++-side function that interops into C++ code.
      // cppTargetFunc: Function pointer (an integer to FUNCTION_TABLE) to the target C++ function the cppInvokerFunc will end up calling.
      var argCount = argTypes.length;
  
      if (argCount < 2) {
          throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
      }
  
      var isClassMethodFunc = (argTypes[1] !== null && classType !== null);
  
      // Free functions with signature "void function()" do not need an invoker that marshalls between wire types.
  // TODO: This omits argument count check - enable only at -O3 or similar.
  //    if (ENABLE_UNSAFE_OPTS && argCount == 2 && argTypes[0].name == "void" && !isClassMethodFunc) {
  //       return FUNCTION_TABLE[fn];
  //    }
  
  
      // Determine if we need to use a dynamic stack to store the destructors for the function parameters.
      // TODO: Remove this completely once all function invokers are being dynamically generated.
      var needsDestructorStack = false;
  
      for(var i = 1; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here.
          if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) { // The type does not define a destructor function - must use dynamic stack
              needsDestructorStack = true;
              break;
          }
      }
  
      var returns = (argTypes[0].name !== "void");
  
      var argsList = "";
      var argsListWired = "";
      for(var i = 0; i < argCount - 2; ++i) {
          argsList += (i!==0?", ":"")+"arg"+i;
          argsListWired += (i!==0?", ":"")+"arg"+i+"Wired";
      }
  
      var invokerFnBody =
          "return function "+makeLegalFunctionName(humanName)+"("+argsList+") {\n" +
          "if (arguments.length !== "+(argCount - 2)+") {\n" +
              "throwBindingError('function "+humanName+" called with ' + arguments.length + ' arguments, expected "+(argCount - 2)+" args!');\n" +
          "}\n";
  
  
      if (needsDestructorStack) {
          invokerFnBody +=
              "var destructors = [];\n";
      }
  
      var dtorStack = needsDestructorStack ? "destructors" : "null";
      var args1 = ["throwBindingError", "invoker", "fn", "runDestructors", "retType", "classParam"];
      var args2 = [throwBindingError, cppInvokerFunc, cppTargetFunc, runDestructors, argTypes[0], argTypes[1]];
  
  
      if (isClassMethodFunc) {
          invokerFnBody += "var thisWired = classParam.toWireType("+dtorStack+", this);\n";
      }
  
      for(var i = 0; i < argCount - 2; ++i) {
          invokerFnBody += "var arg"+i+"Wired = argType"+i+".toWireType("+dtorStack+", arg"+i+"); // "+argTypes[i+2].name+"\n";
          args1.push("argType"+i);
          args2.push(argTypes[i+2]);
      }
  
      if (isClassMethodFunc) {
          argsListWired = "thisWired" + (argsListWired.length > 0 ? ", " : "") + argsListWired;
      }
  
      invokerFnBody +=
          (returns?"var rv = ":"") + "invoker(fn"+(argsListWired.length>0?", ":"")+argsListWired+");\n";
  
      if (needsDestructorStack) {
          invokerFnBody += "runDestructors(destructors);\n";
      } else {
          for(var i = isClassMethodFunc?1:2; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here. Also skip class type if not a method.
              var paramName = (i === 1 ? "thisWired" : ("arg"+(i - 2)+"Wired"));
              if (argTypes[i].destructorFunction !== null) {
                  invokerFnBody += paramName+"_dtor("+paramName+"); // "+argTypes[i].name+"\n";
                  args1.push(paramName+"_dtor");
                  args2.push(argTypes[i].destructorFunction);
              }
          }
      }
  
      if (returns) {
          invokerFnBody += "var ret = retType.fromWireType(rv);\n" +
                           "return ret;\n";
      } else {
      }
      invokerFnBody += "}\n";
  
      args1.push(invokerFnBody);
  
      var invokerFunction = new_(Function, args1).apply(null, args2);
      return invokerFunction;
    }function __embind_register_function(name, argCount, rawArgTypesAddr, signature, rawInvoker, fn) {
      var argTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
      name = readLatin1String(name);
  
      rawInvoker = embind__requireFunction(signature, rawInvoker);
  
      exposePublicSymbol(name, function() {
          throwUnboundTypeError('Cannot call ' + name + ' due to unbound types', argTypes);
      }, argCount - 1);
  
      whenDependentTypesAreResolved([], argTypes, function(argTypes) {
          var invokerArgsArray = [argTypes[0] /* return value */, null /* no class 'this'*/].concat(argTypes.slice(1) /* actual params */);
          replacePublicSymbol(name, craftInvokerFunction(name, invokerArgsArray, null /* no class 'this'*/, rawInvoker, fn), argCount - 1);
          return [];
      });
    }

  
  function integerReadValueFromPointer(name, shift, signed) {
      // integers are quite common, so generate very specialized functions
      switch (shift) {
          case 0: return signed ?
              function readS8FromPointer(pointer) { return HEAP8[pointer]; } :
              function readU8FromPointer(pointer) { return HEAPU8[pointer]; };
          case 1: return signed ?
              function readS16FromPointer(pointer) { return HEAP16[pointer >> 1]; } :
              function readU16FromPointer(pointer) { return HEAPU16[pointer >> 1]; };
          case 2: return signed ?
              function readS32FromPointer(pointer) { return HEAP32[pointer >> 2]; } :
              function readU32FromPointer(pointer) { return HEAPU32[pointer >> 2]; };
          default:
              throw new TypeError("Unknown integer type: " + name);
      }
    }function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
      name = readLatin1String(name);
      if (maxRange === -1) { // LLVM doesn't have signed and unsigned 32-bit types, so u32 literals come out as 'i32 -1'. Always treat those as max u32.
          maxRange = 4294967295;
      }
  
      var shift = getShiftFromSize(size);
  
      var fromWireType = function(value) {
          return value;
      };
  
      if (minRange === 0) {
          var bitshift = 32 - 8*size;
          fromWireType = function(value) {
              return (value << bitshift) >>> bitshift;
          };
      }
  
      var isUnsignedType = (name.indexOf('unsigned') != -1);
  
      registerType(primitiveType, {
          name: name,
          'fromWireType': fromWireType,
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following two if()s and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              if (value < minRange || value > maxRange) {
                  throw new TypeError('Passing a number "' + _embind_repr(value) + '" from JS side to C/C++ side to an argument of type "' + name + '", which is outside the valid range [' + minRange + ', ' + maxRange + ']!');
              }
              return isUnsignedType ? (value >>> 0) : (value | 0);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': integerReadValueFromPointer(name, shift, minRange !== 0),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  function __embind_register_memory_view(rawType, dataTypeIndex, name) {
      var typeMapping = [
          Int8Array,
          Uint8Array,
          Int16Array,
          Uint16Array,
          Int32Array,
          Uint32Array,
          Float32Array,
          Float64Array,
      ];
  
      var TA = typeMapping[dataTypeIndex];
  
      function decodeMemoryView(handle) {
          handle = handle >> 2;
          var heap = HEAPU32;
          var size = heap[handle]; // in elements
          var data = heap[handle + 1]; // byte offset into emscripten heap
          return new TA(buffer, data, size);
      }
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': decodeMemoryView,
          'argPackAdvance': 8,
          'readValueFromPointer': decodeMemoryView,
      }, {
          ignoreDuplicateRegistrations: true,
      });
    }

  function __embind_register_std_string(rawType, name) {
      name = readLatin1String(name);
      var stdStringIsUTF8
      //process only std::string bindings with UTF8 support, in contrast to e.g. std::basic_string<unsigned char>
      = (name === "std::string");
  
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              var length = HEAPU32[value >> 2];
  
              var str;
              if (stdStringIsUTF8) {
                  //ensure null termination at one-past-end byte if not present yet
                  var endChar = HEAPU8[value + 4 + length];
                  var endCharSwap = 0;
                  if (endChar != 0) {
                      endCharSwap = endChar;
                      HEAPU8[value + 4 + length] = 0;
                  }
  
                  var decodeStartPtr = value + 4;
                  // Looping here to support possible embedded '0' bytes
                  for (var i = 0; i <= length; ++i) {
                      var currentBytePtr = value + 4 + i;
                      if (HEAPU8[currentBytePtr] == 0) {
                          var stringSegment = UTF8ToString(decodeStartPtr);
                          if (str === undefined) {
                              str = stringSegment;
                          } else {
                              str += String.fromCharCode(0);
                              str += stringSegment;
                          }
                          decodeStartPtr = currentBytePtr + 1;
                      }
                  }
  
                  if (endCharSwap != 0) {
                      HEAPU8[value + 4 + length] = endCharSwap;
                  }
              } else {
                  var a = new Array(length);
                  for (var i = 0; i < length; ++i) {
                      a[i] = String.fromCharCode(HEAPU8[value + 4 + i]);
                  }
                  str = a.join('');
              }
  
              _free(value);
  
              return str;
          },
          'toWireType': function(destructors, value) {
              if (value instanceof ArrayBuffer) {
                  value = new Uint8Array(value);
              }
  
              var getLength;
              var valueIsOfTypeString = (typeof value === 'string');
  
              if (!(valueIsOfTypeString || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Int8Array)) {
                  throwBindingError('Cannot pass non-string to std::string');
              }
              if (stdStringIsUTF8 && valueIsOfTypeString) {
                  getLength = function() {return lengthBytesUTF8(value);};
              } else {
                  getLength = function() {return value.length;};
              }
  
              // assumes 4-byte alignment
              var length = getLength();
              var ptr = _malloc(4 + length + 1);
              HEAPU32[ptr >> 2] = length;
  
              if (stdStringIsUTF8 && valueIsOfTypeString) {
                  stringToUTF8(value, ptr + 4, length + 1);
              } else {
                  if (valueIsOfTypeString) {
                      for (var i = 0; i < length; ++i) {
                          var charCode = value.charCodeAt(i);
                          if (charCode > 255) {
                              _free(ptr);
                              throwBindingError('String has UTF-16 code units that do not fit in 8 bits');
                          }
                          HEAPU8[ptr + 4 + i] = charCode;
                      }
                  } else {
                      for (var i = 0; i < length; ++i) {
                          HEAPU8[ptr + 4 + i] = value[i];
                      }
                  }
              }
  
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  function __embind_register_std_wstring(rawType, charSize, name) {
      name = readLatin1String(name);
      var decodeString, encodeString, getHeap, lengthBytesUTF, shift;
      if (charSize === 2) {
          decodeString = UTF16ToString;
          encodeString = stringToUTF16;
          lengthBytesUTF = lengthBytesUTF16;
          getHeap = function() { return HEAPU16; };
          shift = 1;
      } else if (charSize === 4) {
          decodeString = UTF32ToString;
          encodeString = stringToUTF32;
          lengthBytesUTF = lengthBytesUTF32;
          getHeap = function() { return HEAPU32; };
          shift = 2;
      }
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              // Code mostly taken from _embind_register_std_string fromWireType
              var length = HEAPU32[value >> 2];
              var HEAP = getHeap();
              var str;
              // Ensure null termination at one-past-end byte if not present yet
              var endChar = HEAP[(value + 4 + length * charSize) >> shift];
              var endCharSwap = 0;
              if (endChar != 0) {
                  endCharSwap = endChar;
                  HEAP[(value + 4 + length * charSize) >> shift] = 0;
              }
  
              var decodeStartPtr = value + 4;
              // Looping here to support possible embedded '0' bytes
              for (var i = 0; i <= length; ++i) {
                  var currentBytePtr = value + 4 + i * charSize;
                  if (HEAP[currentBytePtr >> shift] == 0) {
                      var stringSegment = decodeString(decodeStartPtr);
                      if (str === undefined) {
                          str = stringSegment;
                      } else {
                          str += String.fromCharCode(0);
                          str += stringSegment;
                      }
                      decodeStartPtr = currentBytePtr + charSize;
                  }
              }
  
              if (endCharSwap != 0) {
                  HEAP[(value + 4 + length * charSize) >> shift] = endCharSwap;
              }
  
              _free(value);
  
              return str;
          },
          'toWireType': function(destructors, value) {
              if (!(typeof value === 'string')) {
                  throwBindingError('Cannot pass non-string to C++ string type ' + name);
              }
  
              // assumes 4-byte alignment
              var length = lengthBytesUTF(value);
              var ptr = _malloc(4 + length + charSize);
              HEAPU32[ptr >> 2] = length >> shift;
  
              encodeString(value, ptr + 4, length + charSize);
  
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  function __embind_register_void(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          isVoid: true, // void return values can be optimized out sometimes
          name: name,
          'argPackAdvance': 0,
          'fromWireType': function() {
              return undefined;
          },
          'toWireType': function(destructors, o) {
              // TODO: assert if anything else is given?
              return undefined;
          },
      });
    }

  function _emscripten_get_sbrk_ptr() {
      return 4448;
    }

  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.copyWithin(dest, src, src + num);
    }

  
  function _emscripten_get_heap_size() {
      return HEAPU8.length;
    }
  
  function abortOnCannotGrowMemory(requestedSize) {
      abort('Cannot enlarge memory arrays to size ' + requestedSize + ' bytes (OOM). Either (1) compile with  -s INITIAL_MEMORY=X  with X higher than the current value ' + HEAP8.length + ', (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ');
    }function _emscripten_resize_heap(requestedSize) {
      abortOnCannotGrowMemory(requestedSize);
    }
embind_init_charCodes();
BindingError = Module['BindingError'] = extendError(Error, 'BindingError');;
InternalError = Module['InternalError'] = extendError(Error, 'InternalError');;
init_ClassHandle();
init_RegisteredPointer();
init_embind();;
UnboundTypeError = Module['UnboundTypeError'] = extendError(Error, 'UnboundTypeError');;
init_emval();;
var ASSERTIONS = true;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149

// This code was written by Tyler Akins and has been placed in the
// public domain.  It would be nice if you left this header intact.
// Base64 code from Tyler Akins -- http://rumkin.com

/**
 * Decodes a base64 string.
 * @param {string} input The string to decode.
 */
var decodeBase64 = typeof atob === 'function' ? atob : function (input) {
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  do {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));

    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;

    output = output + String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  } while (i < input.length);
  return output;
};

// Converts a string of base64 into a byte array.
// Throws error on invalid input.
function intArrayFromBase64(s) {
  if (typeof ENVIRONMENT_IS_NODE === 'boolean' && ENVIRONMENT_IS_NODE) {
    var buf;
    try {
      // TODO: Update Node.js externs, Closure does not recognize the following Buffer.from()
      /**@suppress{checkTypes}*/
      buf = Buffer.from(s, 'base64');
    } catch (_) {
      buf = new Buffer(s, 'base64');
    }
    return new Uint8Array(buf['buffer'], buf['byteOffset'], buf['byteLength']);
  }

  try {
    var decoded = decodeBase64(s);
    var bytes = new Uint8Array(decoded.length);
    for (var i = 0 ; i < decoded.length ; ++i) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new Error('Converting base64 string to bytes failed.');
  }
}

// If filename is a base64 data URI, parses and returns data (Buffer on node,
// Uint8Array otherwise). If filename is not a base64 data URI, returns undefined.
function tryParseAsDataURI(filename) {
  if (!isDataURI(filename)) {
    return;
  }

  return intArrayFromBase64(filename.slice(dataURIPrefix.length));
}


var asmGlobalArg = {};
var asmLibraryArg = { "__handle_stack_overflow": ___handle_stack_overflow, "_embind_register_bool": __embind_register_bool, "_embind_register_class": __embind_register_class, "_embind_register_class_constructor": __embind_register_class_constructor, "_embind_register_class_property": __embind_register_class_property, "_embind_register_emval": __embind_register_emval, "_embind_register_float": __embind_register_float, "_embind_register_function": __embind_register_function, "_embind_register_integer": __embind_register_integer, "_embind_register_memory_view": __embind_register_memory_view, "_embind_register_std_string": __embind_register_std_string, "_embind_register_std_wstring": __embind_register_std_wstring, "_embind_register_void": __embind_register_void, "emscripten_get_sbrk_ptr": _emscripten_get_sbrk_ptr, "emscripten_memcpy_big": _emscripten_memcpy_big, "emscripten_resize_heap": _emscripten_resize_heap, "getTempRet0": getTempRet0, "memory": wasmMemory, "setTempRet0": setTempRet0, "table": wasmTable };
var asm = createWasm();
Module["asm"] = asm;
/** @type {function(...*):?} */
var ___wasm_call_ctors = Module["___wasm_call_ctors"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__wasm_call_ctors"].apply(null, arguments)
};

/** @type {function(...*):?} */
var _calc = Module["_calc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["calc"].apply(null, arguments)
};

/** @type {function(...*):?} */
var ___errno_location = Module["___errno_location"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__errno_location"].apply(null, arguments)
};

/** @type {function(...*):?} */
var _fflush = Module["_fflush"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["fflush"].apply(null, arguments)
};

/** @type {function(...*):?} */
var ___getTypeName = Module["___getTypeName"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__getTypeName"].apply(null, arguments)
};

/** @type {function(...*):?} */
var ___embind_register_native_and_builtin_types = Module["___embind_register_native_and_builtin_types"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__embind_register_native_and_builtin_types"].apply(null, arguments)
};

/** @type {function(...*):?} */
var ___set_stack_limit = Module["___set_stack_limit"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__set_stack_limit"].apply(null, arguments)
};

/** @type {function(...*):?} */
var stackSave = Module["stackSave"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackSave"].apply(null, arguments)
};

/** @type {function(...*):?} */
var stackAlloc = Module["stackAlloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackAlloc"].apply(null, arguments)
};

/** @type {function(...*):?} */
var stackRestore = Module["stackRestore"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackRestore"].apply(null, arguments)
};

/** @type {function(...*):?} */
var __growWasmMemory = Module["__growWasmMemory"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["__growWasmMemory"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_ii = Module["dynCall_ii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_ii"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_viii = Module["dynCall_viii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viii"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_iii = Module["dynCall_iii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iii"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_i = Module["dynCall_i"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_i"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_vi = Module["dynCall_vi"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vi"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_iiii = Module["dynCall_iiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiii"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_viiiiii = Module["dynCall_viiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiiiii"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_viiiii = Module["dynCall_viiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiiii"].apply(null, arguments)
};

/** @type {function(...*):?} */
var dynCall_viiii = Module["dynCall_viiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiii"].apply(null, arguments)
};




// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;

if (!Object.getOwnPropertyDescriptor(Module, "intArrayFromString")) Module["intArrayFromString"] = function() { abort("'intArrayFromString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "intArrayToString")) Module["intArrayToString"] = function() { abort("'intArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
Module["ccall"] = ccall;
Module["cwrap"] = cwrap;
if (!Object.getOwnPropertyDescriptor(Module, "setValue")) Module["setValue"] = function() { abort("'setValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getValue")) Module["getValue"] = function() { abort("'getValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocate")) Module["allocate"] = function() { abort("'allocate' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getMemory")) Module["getMemory"] = function() { abort("'getMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF8ArrayToString")) Module["UTF8ArrayToString"] = function() { abort("'UTF8ArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF8ToString")) Module["UTF8ToString"] = function() { abort("'UTF8ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF8Array")) Module["stringToUTF8Array"] = function() { abort("'stringToUTF8Array' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF8")) Module["stringToUTF8"] = function() { abort("'stringToUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF8")) Module["lengthBytesUTF8"] = function() { abort("'lengthBytesUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackTrace")) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPreRun")) Module["addOnPreRun"] = function() { abort("'addOnPreRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnInit")) Module["addOnInit"] = function() { abort("'addOnInit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPreMain")) Module["addOnPreMain"] = function() { abort("'addOnPreMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnExit")) Module["addOnExit"] = function() { abort("'addOnExit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPostRun")) Module["addOnPostRun"] = function() { abort("'addOnPostRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeStringToMemory")) Module["writeStringToMemory"] = function() { abort("'writeStringToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeArrayToMemory")) Module["writeArrayToMemory"] = function() { abort("'writeArrayToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeAsciiToMemory")) Module["writeAsciiToMemory"] = function() { abort("'writeAsciiToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addRunDependency")) Module["addRunDependency"] = function() { abort("'addRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "removeRunDependency")) Module["removeRunDependency"] = function() { abort("'removeRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createFolder")) Module["FS_createFolder"] = function() { abort("'FS_createFolder' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createPath")) Module["FS_createPath"] = function() { abort("'FS_createPath' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createDataFile")) Module["FS_createDataFile"] = function() { abort("'FS_createDataFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createPreloadedFile")) Module["FS_createPreloadedFile"] = function() { abort("'FS_createPreloadedFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createLazyFile")) Module["FS_createLazyFile"] = function() { abort("'FS_createLazyFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createLink")) Module["FS_createLink"] = function() { abort("'FS_createLink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createDevice")) Module["FS_createDevice"] = function() { abort("'FS_createDevice' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_unlink")) Module["FS_unlink"] = function() { abort("'FS_unlink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "dynamicAlloc")) Module["dynamicAlloc"] = function() { abort("'dynamicAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "loadDynamicLibrary")) Module["loadDynamicLibrary"] = function() { abort("'loadDynamicLibrary' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "loadWebAssemblyModule")) Module["loadWebAssemblyModule"] = function() { abort("'loadWebAssemblyModule' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getLEB")) Module["getLEB"] = function() { abort("'getLEB' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getFunctionTables")) Module["getFunctionTables"] = function() { abort("'getFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "alignFunctionTables")) Module["alignFunctionTables"] = function() { abort("'alignFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registerFunctions")) Module["registerFunctions"] = function() { abort("'registerFunctions' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addFunction")) Module["addFunction"] = function() { abort("'addFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "removeFunction")) Module["removeFunction"] = function() { abort("'removeFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getFuncWrapper")) Module["getFuncWrapper"] = function() { abort("'getFuncWrapper' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "prettyPrint")) Module["prettyPrint"] = function() { abort("'prettyPrint' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "makeBigInt")) Module["makeBigInt"] = function() { abort("'makeBigInt' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "dynCall")) Module["dynCall"] = function() { abort("'dynCall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getCompilerSetting")) Module["getCompilerSetting"] = function() { abort("'getCompilerSetting' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "print")) Module["print"] = function() { abort("'print' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "printErr")) Module["printErr"] = function() { abort("'printErr' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getTempRet0")) Module["getTempRet0"] = function() { abort("'getTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setTempRet0")) Module["setTempRet0"] = function() { abort("'setTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "callMain")) Module["callMain"] = function() { abort("'callMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "abort")) Module["abort"] = function() { abort("'abort' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToNewUTF8")) Module["stringToNewUTF8"] = function() { abort("'stringToNewUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "abortOnCannotGrowMemory")) Module["abortOnCannotGrowMemory"] = function() { abort("'abortOnCannotGrowMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscripten_realloc_buffer")) Module["emscripten_realloc_buffer"] = function() { abort("'emscripten_realloc_buffer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ENV")) Module["ENV"] = function() { abort("'ENV' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setjmpId")) Module["setjmpId"] = function() { abort("'setjmpId' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ERRNO_CODES")) Module["ERRNO_CODES"] = function() { abort("'ERRNO_CODES' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ERRNO_MESSAGES")) Module["ERRNO_MESSAGES"] = function() { abort("'ERRNO_MESSAGES' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "DNS")) Module["DNS"] = function() { abort("'DNS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GAI_ERRNO_MESSAGES")) Module["GAI_ERRNO_MESSAGES"] = function() { abort("'GAI_ERRNO_MESSAGES' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Protocols")) Module["Protocols"] = function() { abort("'Protocols' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Sockets")) Module["Sockets"] = function() { abort("'Sockets' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UNWIND_CACHE")) Module["UNWIND_CACHE"] = function() { abort("'UNWIND_CACHE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "readAsmConstArgs")) Module["readAsmConstArgs"] = function() { abort("'readAsmConstArgs' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "jstoi_q")) Module["jstoi_q"] = function() { abort("'jstoi_q' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "jstoi_s")) Module["jstoi_s"] = function() { abort("'jstoi_s' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PATH")) Module["PATH"] = function() { abort("'PATH' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PATH_FS")) Module["PATH_FS"] = function() { abort("'PATH_FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SYSCALLS")) Module["SYSCALLS"] = function() { abort("'SYSCALLS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "syscallMmap2")) Module["syscallMmap2"] = function() { abort("'syscallMmap2' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "syscallMunmap")) Module["syscallMunmap"] = function() { abort("'syscallMunmap' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "flush_NO_FILESYSTEM")) Module["flush_NO_FILESYSTEM"] = function() { abort("'flush_NO_FILESYSTEM' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "JSEvents")) Module["JSEvents"] = function() { abort("'JSEvents' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "demangle")) Module["demangle"] = function() { abort("'demangle' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "demangleAll")) Module["demangleAll"] = function() { abort("'demangleAll' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "jsStackTrace")) Module["jsStackTrace"] = function() { abort("'jsStackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackTrace")) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToI64")) Module["writeI53ToI64"] = function() { abort("'writeI53ToI64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToI64Clamped")) Module["writeI53ToI64Clamped"] = function() { abort("'writeI53ToI64Clamped' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToI64Signaling")) Module["writeI53ToI64Signaling"] = function() { abort("'writeI53ToI64Signaling' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToU64Clamped")) Module["writeI53ToU64Clamped"] = function() { abort("'writeI53ToU64Clamped' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeI53ToU64Signaling")) Module["writeI53ToU64Signaling"] = function() { abort("'writeI53ToU64Signaling' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "readI53FromI64")) Module["readI53FromI64"] = function() { abort("'readI53FromI64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "readI53FromU64")) Module["readI53FromU64"] = function() { abort("'readI53FromU64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "convertI32PairToI53")) Module["convertI32PairToI53"] = function() { abort("'convertI32PairToI53' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "convertU32PairToI53")) Module["convertU32PairToI53"] = function() { abort("'convertU32PairToI53' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Browser")) Module["Browser"] = function() { abort("'Browser' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "FS")) Module["FS"] = function() { abort("'FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "MEMFS")) Module["MEMFS"] = function() { abort("'MEMFS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "TTY")) Module["TTY"] = function() { abort("'TTY' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PIPEFS")) Module["PIPEFS"] = function() { abort("'PIPEFS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SOCKFS")) Module["SOCKFS"] = function() { abort("'SOCKFS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GL")) Module["GL"] = function() { abort("'GL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGet")) Module["emscriptenWebGLGet"] = function() { abort("'emscriptenWebGLGet' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetTexPixelData")) Module["emscriptenWebGLGetTexPixelData"] = function() { abort("'emscriptenWebGLGetTexPixelData' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetUniform")) Module["emscriptenWebGLGetUniform"] = function() { abort("'emscriptenWebGLGetUniform' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emscriptenWebGLGetVertexAttrib")) Module["emscriptenWebGLGetVertexAttrib"] = function() { abort("'emscriptenWebGLGetVertexAttrib' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "AL")) Module["AL"] = function() { abort("'AL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SDL")) Module["SDL"] = function() { abort("'SDL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "SDL_gfx")) Module["SDL_gfx"] = function() { abort("'SDL_gfx' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLUT")) Module["GLUT"] = function() { abort("'GLUT' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "EGL")) Module["EGL"] = function() { abort("'EGL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLFW_Window")) Module["GLFW_Window"] = function() { abort("'GLFW_Window' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLFW")) Module["GLFW"] = function() { abort("'GLFW' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "GLEW")) Module["GLEW"] = function() { abort("'GLEW' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "IDBStore")) Module["IDBStore"] = function() { abort("'IDBStore' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "runAndAbortIfError")) Module["runAndAbortIfError"] = function() { abort("'runAndAbortIfError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emval_handle_array")) Module["emval_handle_array"] = function() { abort("'emval_handle_array' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emval_free_list")) Module["emval_free_list"] = function() { abort("'emval_free_list' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emval_symbols")) Module["emval_symbols"] = function() { abort("'emval_symbols' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "init_emval")) Module["init_emval"] = function() { abort("'init_emval' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "count_emval_handles")) Module["count_emval_handles"] = function() { abort("'count_emval_handles' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "get_first_emval")) Module["get_first_emval"] = function() { abort("'get_first_emval' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getStringOrSymbol")) Module["getStringOrSymbol"] = function() { abort("'getStringOrSymbol' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "requireHandle")) Module["requireHandle"] = function() { abort("'requireHandle' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emval_newers")) Module["emval_newers"] = function() { abort("'emval_newers' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "craftEmvalAllocator")) Module["craftEmvalAllocator"] = function() { abort("'craftEmvalAllocator' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emval_get_global")) Module["emval_get_global"] = function() { abort("'emval_get_global' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "emval_methodCallers")) Module["emval_methodCallers"] = function() { abort("'emval_methodCallers' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "InternalError")) Module["InternalError"] = function() { abort("'InternalError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "BindingError")) Module["BindingError"] = function() { abort("'BindingError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UnboundTypeError")) Module["UnboundTypeError"] = function() { abort("'UnboundTypeError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "PureVirtualError")) Module["PureVirtualError"] = function() { abort("'PureVirtualError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "init_embind")) Module["init_embind"] = function() { abort("'init_embind' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "throwInternalError")) Module["throwInternalError"] = function() { abort("'throwInternalError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "throwBindingError")) Module["throwBindingError"] = function() { abort("'throwBindingError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "throwUnboundTypeError")) Module["throwUnboundTypeError"] = function() { abort("'throwUnboundTypeError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ensureOverloadTable")) Module["ensureOverloadTable"] = function() { abort("'ensureOverloadTable' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "exposePublicSymbol")) Module["exposePublicSymbol"] = function() { abort("'exposePublicSymbol' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "replacePublicSymbol")) Module["replacePublicSymbol"] = function() { abort("'replacePublicSymbol' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "extendError")) Module["extendError"] = function() { abort("'extendError' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "createNamedFunction")) Module["createNamedFunction"] = function() { abort("'createNamedFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registeredInstances")) Module["registeredInstances"] = function() { abort("'registeredInstances' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getBasestPointer")) Module["getBasestPointer"] = function() { abort("'getBasestPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registerInheritedInstance")) Module["registerInheritedInstance"] = function() { abort("'registerInheritedInstance' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "unregisterInheritedInstance")) Module["unregisterInheritedInstance"] = function() { abort("'unregisterInheritedInstance' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getInheritedInstance")) Module["getInheritedInstance"] = function() { abort("'getInheritedInstance' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getInheritedInstanceCount")) Module["getInheritedInstanceCount"] = function() { abort("'getInheritedInstanceCount' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getLiveInheritedInstances")) Module["getLiveInheritedInstances"] = function() { abort("'getLiveInheritedInstances' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registeredTypes")) Module["registeredTypes"] = function() { abort("'registeredTypes' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "awaitingDependencies")) Module["awaitingDependencies"] = function() { abort("'awaitingDependencies' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "typeDependencies")) Module["typeDependencies"] = function() { abort("'typeDependencies' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registeredPointers")) Module["registeredPointers"] = function() { abort("'registeredPointers' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registerType")) Module["registerType"] = function() { abort("'registerType' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "whenDependentTypesAreResolved")) Module["whenDependentTypesAreResolved"] = function() { abort("'whenDependentTypesAreResolved' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "embind_charCodes")) Module["embind_charCodes"] = function() { abort("'embind_charCodes' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "embind_init_charCodes")) Module["embind_init_charCodes"] = function() { abort("'embind_init_charCodes' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "readLatin1String")) Module["readLatin1String"] = function() { abort("'readLatin1String' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getTypeName")) Module["getTypeName"] = function() { abort("'getTypeName' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "heap32VectorToArray")) Module["heap32VectorToArray"] = function() { abort("'heap32VectorToArray' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "requireRegisteredType")) Module["requireRegisteredType"] = function() { abort("'requireRegisteredType' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getShiftFromSize")) Module["getShiftFromSize"] = function() { abort("'getShiftFromSize' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "integerReadValueFromPointer")) Module["integerReadValueFromPointer"] = function() { abort("'integerReadValueFromPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "enumReadValueFromPointer")) Module["enumReadValueFromPointer"] = function() { abort("'enumReadValueFromPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "floatReadValueFromPointer")) Module["floatReadValueFromPointer"] = function() { abort("'floatReadValueFromPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "simpleReadValueFromPointer")) Module["simpleReadValueFromPointer"] = function() { abort("'simpleReadValueFromPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "runDestructors")) Module["runDestructors"] = function() { abort("'runDestructors' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "new_")) Module["new_"] = function() { abort("'new_' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "craftInvokerFunction")) Module["craftInvokerFunction"] = function() { abort("'craftInvokerFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "embind__requireFunction")) Module["embind__requireFunction"] = function() { abort("'embind__requireFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "tupleRegistrations")) Module["tupleRegistrations"] = function() { abort("'tupleRegistrations' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "structRegistrations")) Module["structRegistrations"] = function() { abort("'structRegistrations' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "genericPointerToWireType")) Module["genericPointerToWireType"] = function() { abort("'genericPointerToWireType' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "constNoSmartPtrRawPointerToWireType")) Module["constNoSmartPtrRawPointerToWireType"] = function() { abort("'constNoSmartPtrRawPointerToWireType' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "nonConstNoSmartPtrRawPointerToWireType")) Module["nonConstNoSmartPtrRawPointerToWireType"] = function() { abort("'nonConstNoSmartPtrRawPointerToWireType' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "init_RegisteredPointer")) Module["init_RegisteredPointer"] = function() { abort("'init_RegisteredPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "RegisteredPointer")) Module["RegisteredPointer"] = function() { abort("'RegisteredPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "RegisteredPointer_getPointee")) Module["RegisteredPointer_getPointee"] = function() { abort("'RegisteredPointer_getPointee' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "RegisteredPointer_destructor")) Module["RegisteredPointer_destructor"] = function() { abort("'RegisteredPointer_destructor' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "RegisteredPointer_deleteObject")) Module["RegisteredPointer_deleteObject"] = function() { abort("'RegisteredPointer_deleteObject' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "RegisteredPointer_fromWireType")) Module["RegisteredPointer_fromWireType"] = function() { abort("'RegisteredPointer_fromWireType' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "runDestructor")) Module["runDestructor"] = function() { abort("'runDestructor' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "releaseClassHandle")) Module["releaseClassHandle"] = function() { abort("'releaseClassHandle' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "finalizationGroup")) Module["finalizationGroup"] = function() { abort("'finalizationGroup' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "detachFinalizer_deps")) Module["detachFinalizer_deps"] = function() { abort("'detachFinalizer_deps' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "detachFinalizer")) Module["detachFinalizer"] = function() { abort("'detachFinalizer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "attachFinalizer")) Module["attachFinalizer"] = function() { abort("'attachFinalizer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "makeClassHandle")) Module["makeClassHandle"] = function() { abort("'makeClassHandle' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "init_ClassHandle")) Module["init_ClassHandle"] = function() { abort("'init_ClassHandle' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ClassHandle")) Module["ClassHandle"] = function() { abort("'ClassHandle' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ClassHandle_isAliasOf")) Module["ClassHandle_isAliasOf"] = function() { abort("'ClassHandle_isAliasOf' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "throwInstanceAlreadyDeleted")) Module["throwInstanceAlreadyDeleted"] = function() { abort("'throwInstanceAlreadyDeleted' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ClassHandle_clone")) Module["ClassHandle_clone"] = function() { abort("'ClassHandle_clone' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ClassHandle_delete")) Module["ClassHandle_delete"] = function() { abort("'ClassHandle_delete' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "deletionQueue")) Module["deletionQueue"] = function() { abort("'deletionQueue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ClassHandle_isDeleted")) Module["ClassHandle_isDeleted"] = function() { abort("'ClassHandle_isDeleted' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ClassHandle_deleteLater")) Module["ClassHandle_deleteLater"] = function() { abort("'ClassHandle_deleteLater' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "flushPendingDeletes")) Module["flushPendingDeletes"] = function() { abort("'flushPendingDeletes' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "delayFunction")) Module["delayFunction"] = function() { abort("'delayFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setDelayFunction")) Module["setDelayFunction"] = function() { abort("'setDelayFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "RegisteredClass")) Module["RegisteredClass"] = function() { abort("'RegisteredClass' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "shallowCopyInternalPointer")) Module["shallowCopyInternalPointer"] = function() { abort("'shallowCopyInternalPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "downcastPointer")) Module["downcastPointer"] = function() { abort("'downcastPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "upcastPointer")) Module["upcastPointer"] = function() { abort("'upcastPointer' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "validateThis")) Module["validateThis"] = function() { abort("'validateThis' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "char_0")) Module["char_0"] = function() { abort("'char_0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "char_9")) Module["char_9"] = function() { abort("'char_9' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "makeLegalFunctionName")) Module["makeLegalFunctionName"] = function() { abort("'makeLegalFunctionName' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "warnOnce")) Module["warnOnce"] = function() { abort("'warnOnce' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackSave")) Module["stackSave"] = function() { abort("'stackSave' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackRestore")) Module["stackRestore"] = function() { abort("'stackRestore' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackAlloc")) Module["stackAlloc"] = function() { abort("'stackAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "AsciiToString")) Module["AsciiToString"] = function() { abort("'AsciiToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToAscii")) Module["stringToAscii"] = function() { abort("'stringToAscii' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF16ToString")) Module["UTF16ToString"] = function() { abort("'UTF16ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF16")) Module["stringToUTF16"] = function() { abort("'stringToUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF16")) Module["lengthBytesUTF16"] = function() { abort("'lengthBytesUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF32ToString")) Module["UTF32ToString"] = function() { abort("'UTF32ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF32")) Module["stringToUTF32"] = function() { abort("'stringToUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF32")) Module["lengthBytesUTF32"] = function() { abort("'lengthBytesUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocateUTF8")) Module["allocateUTF8"] = function() { abort("'allocateUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocateUTF8OnStack")) Module["allocateUTF8OnStack"] = function() { abort("'allocateUTF8OnStack' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
Module["writeStackCookie"] = writeStackCookie;
Module["checkStackCookie"] = checkStackCookie;
Module["abortStackOverflow"] = abortStackOverflow;
if (!Object.getOwnPropertyDescriptor(Module, "intArrayFromBase64")) Module["intArrayFromBase64"] = function() { abort("'intArrayFromBase64' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "tryParseAsDataURI")) Module["tryParseAsDataURI"] = function() { abort("'tryParseAsDataURI' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_NORMAL")) Object.defineProperty(Module, "ALLOC_NORMAL", { configurable: true, get: function() { abort("'ALLOC_NORMAL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_STACK")) Object.defineProperty(Module, "ALLOC_STACK", { configurable: true, get: function() { abort("'ALLOC_STACK' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_DYNAMIC")) Object.defineProperty(Module, "ALLOC_DYNAMIC", { configurable: true, get: function() { abort("'ALLOC_DYNAMIC' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_NONE")) Object.defineProperty(Module, "ALLOC_NONE", { configurable: true, get: function() { abort("'ALLOC_NONE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });



var calledRun;


/**
 * @constructor
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
}

var calledMain = false;


dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
};





/** @type {function(Array=)} */
function run(args) {
  args = args || arguments_;

  if (runDependencies > 0) {
    return;
  }

  writeStackCookie();

  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;
    Module['calledRun'] = true;

    if (ABORT) return;

    initRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();

    assert(!Module['_main'], 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
  checkStackCookie();
}
Module['run'] = run;

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var print = out;
  var printErr = err;
  var has = false;
  out = err = function(x) {
    has = true;
  }
  try { // it doesn't matter if it fails
    var flush = null;
    if (flush) flush();
  } catch(e) {}
  out = print;
  err = printErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the FAQ), or make sure to emit a newline when you printf etc.');
    warnOnce('(this may also be due to not including full filesystem support - try building with -s FORCE_FILESYSTEM=1)');
  }
}

/** @param {boolean|number=} implicit */
function exit(status, implicit) {
  checkUnflushedContent();

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && noExitRuntime && status === 0) {
    return;
  }

  if (noExitRuntime) {
    // if exit() was called, we may warn the user if the runtime isn't actually being shut down
    if (!implicit) {
      err('program exited (with status: ' + status + '), but EXIT_RUNTIME is not set, so halting execution but not exiting the runtime or preventing further async execution (build with EXIT_RUNTIME=1, if you want a true shutdown)');
    }
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  quit_(status, new ExitStatus(status));
}

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}


  noExitRuntime = true;

run();





// {{MODULE_ADDITIONS}}



