import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('./routes/dashboard.tsx'),
  route('send', './routes/send.tsx'),
  route('notifications', './routes/history.tsx'),
] satisfies RouteConfig;
