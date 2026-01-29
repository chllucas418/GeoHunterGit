import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("api/submit-turn", "routes/api.submit-turn.ts"),
    route("game/:locationId", "routes/game.$locationId.tsx")
] satisfies RouteConfig;
