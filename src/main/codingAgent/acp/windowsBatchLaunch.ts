import path from 'path';

const CMD_META_CHARACTERS = /([()[\]%!^"`<>&|;, *?])/g;

/** Escape the command and arguments before cmd.exe parses a batch launcher. */
export function windowsBatchArguments(executable: string, args: string[]): string[] {
  const command = path.normalize(executable).replace(CMD_META_CHARACTERS, '^$1');
  const isNpmShim = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(executable);
  const argumentsText = args.map(argument => {
    // Preserve embedded quotes and trailing backslashes for the child argv.
    let escaped = argument.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
    escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
    escaped = `"${escaped}"`.replace(CMD_META_CHARACTERS, '^$1');
    if (isNpmShim) escaped = escaped.replace(CMD_META_CHARACTERS, '^$1');
    return escaped;
  });
  return ['/d', '/s', '/c', `"${[command, ...argumentsText].join(' ')}"`];
}
