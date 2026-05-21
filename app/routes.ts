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
    route("about", "routes/about.tsx"),
    route("support", "routes/support.tsx"),
    route("resources/image/:locationId", "routes/resources.image.$locationId.ts"),

    // Teacher Mode Routes
    route("join", "routes/join.tsx"),
    route("live/:code", "routes/live.$code.tsx"),
    route("teacher/dashboard", "routes/teacher.dashboard.tsx"),
    route("teacher/room/:code", "routes/teacher.room.$code.tsx"),
    route("teacher/control/:code", "routes/teacher.control.$code.tsx"),

    // Admin Routes
    route("admin", "routes/admin.index.tsx"),
    route("admin/create-teacher", "routes/admin.create-teacher.tsx"),
    route("admin/users/:userId", "routes/admin.users.$userId.tsx"),
    route("admin/datasets", "routes/admin.datasets.tsx"),
    route("admin/datasets/:setId", "routes/admin.datasets.$setId.tsx"),
    route("admin/mass-add", "routes/admin.mass-add.tsx"),
    route("api/admin/mass-add", "routes/api.admin.mass-add.ts"),
    route("api/admin/auto-detect", "routes/api.admin.auto-detect.ts"),
    route("api/admin/chat", "routes/api.admin.chat.ts"),
    route("api/admin/export-locations", "routes/api.admin.export-locations.ts"),
    route("api/admin/export-sessions", "routes/api.admin.export-sessions.ts"),

    // Room APIs
    route("api/room/:code/action", "routes/api.room.$code.action.ts"),
    route("api/room/:code/join", "routes/api.room.$code.join.ts"),
    route("api/room/:code/review", "routes/api.room.$code.review.ts"),
    route("api/room/:code/round_result", "routes/api.room.$code.round_result.ts"),
    route("api/room/:code/status", "routes/api.room.$code.status.ts"),
    route("api/room/:code/submit", "routes/api.room.$code.submit.ts"),
    route("api/room/:code/ws", "routes/api.room.$code.ws.ts"),
    route("api/room/:code/hint", "routes/api.room.$code.hint.ts"),

    // Migration Route (Deleted)
] satisfies RouteConfig;
