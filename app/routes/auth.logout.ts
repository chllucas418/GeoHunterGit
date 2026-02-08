import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { destroySession, getSession } from "~/lib/auth.server";

export async function action({ request }: ActionFunctionArgs) {
    const session = await getSession(request);
    return redirect("/", {
        headers: {
            "Set-Cookie": await destroySession(session),
        },
    });
}

export async function loader() {
    return redirect("/");
}
