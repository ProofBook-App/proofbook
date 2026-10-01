import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("builders", "routes/builders.tsx"),
  route("leaderboard", "routes/leaderboard.tsx"),
  route("agent/:id", "routes/agent.tsx"),
  route("portfolio", "routes/portfolio.tsx"),
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("api/leaderboard", "routes/api.leaderboard.ts"),
  route("api/agent/:id", "routes/api.agent.ts"),
  route("api/backer/:address", "routes/api.backer.ts"),
  route("api/drip", "routes/api.drip.ts"),
  route("og/agent/:file", "routes/og.agent.tsx"),
] satisfies RouteConfig;
