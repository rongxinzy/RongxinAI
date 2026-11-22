// Windows Job Object owner. No shell and no taskkill fallback.
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <string>
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <cwchar>

static std::wstring quote(const wchar_t* value) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (const wchar_t* p = value; *p; ++p) {
    if (*p == L'\\') { ++slashes; continue; }
    if (*p == L'"') result.append(slashes * 2 + 1, L'\\');
    else result.append(slashes, L'\\');
    slashes = 0; result += *p;
  }
  result.append(slashes * 2, L'\\'); result += L'"'; return result;
}
static int fail(const wchar_t* action, DWORD error = GetLastError()) {
  fwprintf(stderr, L"Windows Job Object: %ls failed (%lu)\n", action, error);
  return 125;
}

static DWORD createInJob(HANDLE job, const wchar_t* executable, wchar_t* command,
                         PROCESS_INFORMATION* child) {
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
  if (!bytes) return GetLastError();
  std::vector<BYTE> storage(bytes);
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &bytes)) {
    return GetLastError();
  }
  // Create the process inside the job so a stopped launcher cannot leave an unowned child.
  DWORD error = ERROR_SUCCESS;
  if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                 &job, sizeof(job), nullptr, nullptr) ||
      !CreateProcessW(executable, command, nullptr, nullptr, TRUE,
                      EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
                      nullptr, nullptr, &startup.StartupInfo, child)) {
    error = GetLastError();
  }
  DeleteProcThreadAttributeList(startup.lpAttributeList);
  return error;
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 3) { fwprintf(stderr, L"Usage: job-runner parentPid executable [args...]\n"); return 125; }
  wchar_t* end = nullptr;
  unsigned long pid = wcstoul(argv[1], &end, 10);
  if (!pid || *end) return 125;
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(pid));
  if (!parent) return fail(L"OpenProcess(parent)");
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!job) {
    const DWORD error = GetLastError();
    CloseHandle(parent);
    return fail(L"CreateJobObject", error);
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    const DWORD error = GetLastError();
    CloseHandle(job); CloseHandle(parent);
    return fail(L"SetInformationJobObject", error);
  }
  std::wstring command;
  for (int i = 2; i < argc; ++i) { if (i > 2) command += L' '; command += quote(argv[i]); }
  std::vector<wchar_t> mutableCommand(command.begin(), command.end()); mutableCommand.push_back(0);
  PROCESS_INFORMATION child{};
  const DWORD launchError = createInJob(job, argv[2], mutableCommand.data(), &child);
  if (launchError != ERROR_SUCCESS) {
    CloseHandle(job); CloseHandle(parent);
    return fail(L"CreateProcess in job", launchError);
  }
  CloseHandle(child.hThread);
  HANDLE waits[] = { parent, child.hProcess };
  DWORD reason = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
  DWORD code = 125;
  if (reason == WAIT_OBJECT_0 + 1) GetExitCodeProcess(child.hProcess, &code);
  // Parent died, child completed, or wait failed: terminate every descendant before exiting.
  TerminateJobObject(job, reason == WAIT_OBJECT_0 + 1 ? 0 : 125);
  CloseHandle(child.hProcess); CloseHandle(job); CloseHandle(parent);
  return static_cast<int>(code);
}
