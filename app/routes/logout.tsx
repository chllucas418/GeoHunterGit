import type { ActionFunctionArgs } from "react-router";
import { logout } from "~/lib/auth.server";

export async function action({ request }: ActionFunctionArgs) {
    return logout(request);
}

export async function loader() {
    return logout(new Request("http://localhost")); // Fallback just in case
}
