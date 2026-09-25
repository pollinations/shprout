#!/usr/bin/python3
"""Pollinations-only curl transport for the browser VM; no agent logic here."""
import base64, json, os, sys, time, uuid
args = iter(sys.argv[1:])
body, url, method = None, None, None
try:
    for arg in args:
        if arg in ('-d', '--data', '--data-raw', '--data-binary'):
            body = next(args)
            if body.startswith('@'):
                body = sys.stdin.read() if body == '@-' else open(body[1:]).read()
        elif arg in ('-H', '--header'): next(args)  # Real authorization stays in the browser.
        elif arg in ('-X', '--request'): method = next(args)
        elif arg in ('-s', '-S', '-sS', '-fsS', '-f', '--silent', '--show-error', '--fail'): pass
        elif arg.startswith('-'): raise ValueError('unsupported curl option: ' + arg)
        else: url = arg
    if url != 'https://gen.pollinations.ai/v1/chat/completions' or body is None or method not in (None, 'POST'):
        raise ValueError('this curl transport supports only POST to the Pollinations chat endpoint')
    json.loads(body)
    ident = uuid.uuid4().hex
    payload = base64.b64encode(json.dumps({'id': ident, 'body': body}).encode()).decode()
    nonce = os.environ['SHPROUT_BRIDGE']
    with open('/dev/tty', 'w') as tty:
        tty.write('\033]777;shprout;' + nonce + ';' + payload + '\007'); tty.flush()
    path = '/data/reply-' + ident
    deadline = time.monotonic() + 120
    while True:
        try:
            with open(path) as f: reply = json.load(f)
            break
        except FileNotFoundError:
            if time.monotonic() > deadline: raise ValueError('browser model request timed out')
            time.sleep(.05)
    if reply['status'] != 200: raise ValueError('model request failed: HTTP ' + str(reply['status']))
    sys.stdout.write(reply['body'])
except Exception as error:
    print('curl bridge: ' + str(error), file=sys.stderr)
    sys.exit(22)
