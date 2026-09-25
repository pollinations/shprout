// Split only our private OSC messages from a byte stream; preserve ordinary ANSI.
export function consoleProtocol({ nonce, output, message, maxBytes = 2_000_000 }) {
  const start = `\x1b]777;shprout;${nonce};`;
  let buffer = '';
  return chunk => {
    buffer += chunk;
    while (buffer) {
      const index = buffer.indexOf(start);
      if (index < 0) {
        let keep = Math.min(start.length - 1, buffer.length);
        while (keep && !start.startsWith(buffer.slice(-keep))) keep--;
        output(buffer.slice(0, buffer.length - keep));
        buffer = keep ? buffer.slice(-keep) : '';
        return;
      }
      if (index) { output(buffer.slice(0, index)); buffer = buffer.slice(index); }
      const end = buffer.indexOf('\x07', start.length);
      if (end < 0) {
        if (buffer.length > maxBytes) { buffer = ''; throw new Error('Terminal message exceeded the size limit'); }
        return;
      }
      if (end > maxBytes) { buffer = ''; throw new Error('Terminal message exceeded the size limit'); }
      const payload = buffer.slice(start.length, end);
      buffer = buffer.slice(end + 1);
      message(payload);
    }
  };
}
