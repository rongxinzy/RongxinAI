// uv 0.11.32 encodes the interpreter in a named PE resource. Its other resources
// include the launcher kind and embedded script, and must be kept byte-for-byte.
// https://github.com/astral-sh/uv/blob/0.11.32/crates/uv-trampoline-builder/src/lib.rs
export const WINDOWS_WHEEL_EXECUTABLES = String.raw`
import ctypes as c
from ctypes import wintypes as w
from importlib import metadata
from pathlib import Path
import os
import re
import shutil
import sys

kernel = c.WinDLL('kernel32', use_last_error=True)

def winapi(name, result, *args):
    function = getattr(kernel, name)
    function.restype = result
    function.argtypes = args
    return function

load_module = winapi('LoadLibraryExW', w.HMODULE, w.LPCWSTR, w.HANDLE, w.DWORD)
free_module = winapi('FreeLibrary', w.BOOL, w.HMODULE)
find_resource = winapi('FindResourceExW', w.HRSRC, w.HMODULE, c.c_void_p, w.LPCWSTR, w.WORD)
load_resource = winapi('LoadResource', w.HGLOBAL, w.HMODULE, w.HRSRC)
lock_resource = winapi('LockResource', c.c_void_p, w.HGLOBAL)
resource_size = winapi('SizeofResource', w.DWORD, w.HMODULE, w.HRSRC)
begin_update = winapi('BeginUpdateResourceW', w.HANDLE, w.LPCWSTR, w.BOOL)
update_resource = winapi('UpdateResourceW', w.BOOL, w.HANDLE, c.c_void_p, w.LPCWSTR, w.WORD, c.c_void_p, w.DWORD)
end_update = winapi('EndUpdateResourceW', w.BOOL, w.HANDLE, w.BOOL)

RT_RCDATA = 10
LANGUAGE_NEUTRAL = 0
LOAD_AS_DATA = 2
PYTHON_PATH_RESOURCE = 'UV_PYTHON_PATH'
INTERPRETER_FILENAME = re.compile(r'python(?:w|[0-9]+(?:[.][0-9]+)*w?)?[.]exe', re.I)

def legacy_path(path):
    value = str(path)
    if len(value) < 260 or value.startswith('\\\\?\\'):
        return path
    if value.startswith('\\\\'):
        return Path('\\\\?\\UNC\\' + value[2:])
    return Path('\\\\?\\' + value)

def resource_bytes(module, name):
    resource = find_resource(module, RT_RCDATA, name, LANGUAGE_NEUTRAL)
    if not resource:
        return None
    data = load_resource(module, resource)
    size = resource_size(module, resource)
    pointer = lock_resource(data) if data else None
    if not pointer or not size:
        raise OSError(f'Unable to read launcher resource {name}')
    return c.string_at(pointer, size)

def read_uv_interpreter(executable):
    # Map the file as data. DLL entry points are never invoked.
    module = load_module(str(executable), None, LOAD_AS_DATA)
    if not module:
        return None
    try:
        if resource_bytes(module, 'UV_TRAMPOLINE_KIND') not in (b'\x01', b'\x02'):
            return None
        value = resource_bytes(module, PYTHON_PATH_RESOURCE)
        if not value:
            raise OSError(f'Missing interpreter for uv launcher {executable.name}')
        return Path(value.decode('utf-8'))
    finally:
        free_module(module)

def update_uv_interpreter(executable, python):
    # uv resolves a relative resource path from the launcher's own directory.
    data = python.name.encode('utf-8')
    handle = begin_update(str(executable), False)
    if not handle:
        raise c.WinError(c.get_last_error())
    updated = update_resource(handle, RT_RCDATA, PYTHON_PATH_RESOURCE, LANGUAGE_NEUTRAL, data, len(data))
    update_error = c.get_last_error() if not updated else None
    if not end_update(handle, not updated) and updated:
        raise c.WinError(c.get_last_error())
    if update_error is not None:
        raise c.WinError(update_error)

def restore_wheel_executables(distributions, source_scripts, target_scripts):
    for dist in distributions:
        for registered in dist.files or ():
            if registered.suffix.lower() != '.exe':
                continue
            destination = Path(os.path.abspath(dist.locate_file(registered)))
            if destination.parent != target_scripts or INTERPRETER_FILENAME.fullmatch(destination.name):
                continue
            if destination.exists():
                continue
            source = legacy_path(source_scripts / destination.name)
            if source.is_symlink() or not source.is_file():
                continue
            launcher_python = read_uv_interpreter(source)
            target_python = None
            if launcher_python:
                if not INTERPRETER_FILENAME.fullmatch(launcher_python.name):
                    raise OSError(f'Invalid interpreter for uv launcher {source.name}')
                target_python = target_scripts / launcher_python.name
                if not target_python.is_file():
                    raise OSError(f'New interpreter for uv launcher {source.name} is missing')
            shutil.copyfile(source, destination)
            if target_python:
                update_uv_interpreter(destination, target_python)

distributions = list(metadata.distributions())
restore_wheel_executables(distributions, Path(sys.argv[1]), Path(sys.argv[2]))
`;
