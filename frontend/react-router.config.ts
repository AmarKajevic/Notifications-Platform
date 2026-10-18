import type { Config } from '@react-router/dev/config';

export default {
  // SPA mode: this is a pure API client (talks to the gateway over REST),
  // so there's nothing to render server-side. A static build is also
  // simpler to containerize/serve (plain nginx) than a Node SSR server.
  ssr: false,
} satisfies Config;
