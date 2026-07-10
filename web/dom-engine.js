// domprout orchestrator
//
// Each node sees this harness, its task/history, and a fresh snapshot of its
// assigned DOM subtree. It writes one async function body in a ```js fence.
// The sandbox calls that body with `stage` and captured `console` in scope.
//
// Return [] to finish, [{}] to repair/continue on the same subtree, or return
// [{ task, target }, ...] to recurse. `target` is a selector relative to the
// current stage. Parallel children must target distinct, non-overlapping
// subtrees. The runtime validates and resolves targets before they run.

const extractCode = response => {
  const match = response.match(/```(?:js|javascript)?\s*\n([\s\S]*?)(?:\n```|$)/i);
  return match?.[1]?.trim();
};

const compactDom = (html, maxChars) => {
  if (html.length <= maxChars) return html;
  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  return `${html.slice(0, head)}\n<!-- clipped ${html.length - maxChars} chars -->\n${html.slice(-tail)}`;
};

const normalizeSpecs = value => {
  if (!Array.isArray(value)) return [];
  const specs = value.map((spec, index) => {
    if (!spec || Array.isArray(spec) || typeof spec !== 'object') {
      throw new Error(`child ${index} must be an object`);
    }
    const unknown = Object.keys(spec).filter(key => key !== 'task' && key !== 'target');
    if (unknown.length) throw new Error(`child ${index} has unknown keys: ${unknown.join(', ')}`);
    if (spec.task !== undefined && (typeof spec.task !== 'string' || !spec.task.trim())) {
      throw new Error(`child ${index}.task must be a non-empty string`);
    }
    if (spec.target !== undefined && (typeof spec.target !== 'string' || !spec.target.trim())) {
      throw new Error(`child ${index}.target must be a non-empty selector`);
    }
    if ((spec.task?.length ?? 0) > 2000) throw new Error(`child ${index}.task is too long`);
    if ((spec.target?.length ?? 0) > 500) throw new Error(`child ${index}.target is too long`);
    return { task: spec.task?.trim(), target: spec.target?.trim() };
  });

  if (specs.length > 1) {
    if (specs.some(spec => !spec.target)) {
      throw new Error('parallel children must each provide a target selector');
    }
    if (new Set(specs.map(spec => spec.target)).size !== specs.length) {
      throw new Error('parallel children must use distinct target selectors');
    }
  }
  return specs;
};

const taskMessage = (path, task, target) => ({
  role: 'user',
  content: `<task path="${path}"${target ? ` target="${target}"` : ''}>${task}</task>`,
});

export async function runDomAgent({
  task,
  model,
  complete,
  runtime,
  source,
  onEvent = () => {},
  maxSteps = 24,
  maxDepth = 8,
  maxDomChars = 12000,
  signal,
}) {
  const state = { steps: 0, turns: new Map() };
  const system = `${source}\n\nRuntime rule: generated JavaScript runs in an opaque-origin iframe with network disabled. Use only the supplied stage subtree and console. Return child specs to recurse.`;

  const emit = (type, path, detail = {}) => onEvent({ type, path, step: state.steps, ...detail });
  const stopped = () => signal?.aborted;

  const step = async ({ path, handle, messages, depth }) => {
    if (stopped()) return { status: 'aborted', path };
    if (depth > maxDepth) {
      emit('error', path, { text: `maximum depth ${maxDepth} reached` });
      return { status: 'depth-limit', path };
    }
    if (state.steps >= maxSteps) {
      emit('error', path, { text: `maximum step budget ${maxSteps} reached` });
      return { status: 'step-limit', path };
    }

    state.steps += 1;
    const turn = (state.turns.get(path) ?? 0) + 1;
    state.turns.set(path, turn);
    emit('start', path, { turn });

    const dom = compactDom(await runtime.snapshot(handle), maxDomChars);
    emit('snapshot', path, { turn, text: dom });
    const response = await complete({
      model,
      signal,
      path,
      messages: [
        { role: 'system', content: system },
        ...messages,
        { role: 'user', content: `<dom path="${path}">\n${dom}\n</dom>` },
      ],
    });
    if (stopped()) return { status: 'aborted', path };
    emit('response', path, { turn, text: response });

    const code = extractCode(response);
    if (!code) {
      emit('done', path, { turn, reason: 'no-action' });
      return { status: 'done', path };
    }
    emit('action', path, { turn, text: code });

    const execution = await runtime.execute(handle, code);
    const observation = execution.error
      ? `!! ${execution.error}`
      : execution.output || '(no output)';
    emit(execution.error ? 'error' : 'observation', path, { turn, text: observation });
    const nextMessages = [
      ...messages,
      { role: 'assistant', content: response },
      { role: 'user', content: `<observation path="${path}">\n${observation}\n</observation>` },
    ];

    if (execution.error) {
      return step({ path, handle, messages: nextMessages, depth });
    }

    let specs;
    try {
      specs = normalizeSpecs(execution.value);
    } catch (error) {
      const text = `return contract: ${error.message}`;
      emit('error', path, { turn, text });
      return step({
        path,
        handle,
        depth,
        messages: [...nextMessages, { role: 'user', content: `<observation path="${path}">!! ${text}</observation>` }],
      });
    }

    if (specs.length === 0) {
      emit('done', path, { turn, reason: 'empty-return' });
      return { status: 'done', path };
    }

    if (specs.length === 1 && !specs[0].task && !specs[0].target) {
      return step({ path, handle, messages: nextMessages, depth });
    }

    const paths = specs.map((_, index) => `${path}.${index}`);
    let handles;
    try {
      handles = await runtime.resolve(handle, specs, paths);
    } catch (error) {
      const text = `child targets: ${error.message}`;
      emit('error', path, { turn, text });
      return step({
        path,
        handle,
        depth,
        messages: [...nextMessages, { role: 'user', content: `<observation path="${path}">!! ${text}</observation>` }],
      });
    }

    emit('fanout', path, { turn, children: paths });
    const children = specs.map((spec, index) => {
      const childPath = paths[index];
      const childMessages = spec.task
        ? [...nextMessages, taskMessage(childPath, spec.task, spec.target)]
        : nextMessages;
      return step({ path: childPath, handle: handles[index], messages: childMessages, depth: depth + 1 });
    });
    return Promise.all(children);
  };

  emit('run-start', '0', { task, model });
  const result = await step({
    path: '0',
    handle: '0',
    messages: [taskMessage('0', task)],
    depth: 0,
  });
  const outcomes = [result].flat(Infinity);
  const limited = outcomes.some(outcome => outcome?.status === 'step-limit' || outcome?.status === 'depth-limit');
  emit('run-done', '0', { steps: state.steps, aborted: stopped(), limited });
  return { result, steps: state.steps, aborted: stopped(), limited };
}
