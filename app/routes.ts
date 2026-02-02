import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route("logout", "routes/logout.tsx"),
    route("api/submit-turn", "routes/api.submit-turn.ts"),
    route("game/:locationId", "routes/game.$locationId.tsx"),
    route("admin/add-location", "routes/admin.add-location.tsx"),
    route("admin/users", "routes/admin.users.tsx"),
    route("admin/locations", "routes/admin.locations.tsx"),
    route("profile", "routes/profile.tsx"),
    route("leaderboard", "routes/leaderboard.tsx"),
    route("privacy", "routes/privacy.tsx"),
    route("resources/image/:locationId", "routes/resources.image.$locationId.ts")
] satisfies RouteConfig;
