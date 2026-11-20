import { createChatPanel } from '/app/chat-panel.js';

export { clearConversation, answerNodes } from '/app/chat-panel.js';

// The full-page conversation. All the behavior lives in the shared chat panel, which the side drawer also mounts.
export default {
  route: 'preguntar',
  label: 'Preguntar',
  render(ctx) {
    const panel = createChatPanel({ api: ctx.api, variant: 'page' });
    ctx.onCleanup?.(panel.destroy);
    return panel.node;
  },
};
