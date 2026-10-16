// Windows Job Object owner. No shell and no taskkill fallback.
#define WIN32_LEAN_AND_MEAN
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
static int fail(const wchar_t* action) {
  fwprintf(stderr, L"Python Job Object: %ls failed (%lu)\n", action, GetLastError());
  return 125;
}
int wmain(int argc, wchar_t** argv) {
  if (argc < 3) { fwprintf(stderr, L"Usage: job-runner parentPid executable [args...]\n"); return 125; }
  wchar_t* end = nullptr;
  unsigned long pid = wcstoul(argv[1], &end, 10);
  if (!pid || *end) return 125;
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(pid));
  if (!parent) return fail(L"OpenProcess(parent)");
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!job) { CloseHandle(parent); return fail(L"CreateJobObject"); }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    CloseHandle(job); CloseHandle(parent); return fail(L"SetInformationJobObject");
  }
  std::wstring command;
  for (int i = 2; i < argc; ++i) { if (i > 2) command += L' '; command += quote(argv[i]); }
  std::vector<wchar_t> mutableCommand(command.begin(), command.end()); mutableCommand.push_back(0);
  STARTUPINFOW startup{}; startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION child{};
  if (!CreateProcessW(argv[2], mutableCommand.data(), nullptr, nullptr, TRUE,
      CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, nullptr, &startup, &child)) {
    CloseHandle(job); CloseHandle(parent); return fail(L"CreateProcess");
  }
  // No user instruction runs before assignment. Failure is closed, never uncontained.
  if (!AssignProcessToJobObject(job, child.hProcess) || ResumeThread(child.hThread) == static_cast<DWORD>(-1)) {
    TerminateProcess(child.hProcess, 125); CloseHandle(child.hThread); CloseHandle(child.hProcess);
    CloseHandle(job); CloseHandle(parent); return fail(L"AssignProcessToJobObject/ResumeThread");
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
