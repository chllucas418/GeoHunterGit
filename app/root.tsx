import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigation,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

// Separate component to use hook inside Layout if needed, 
// but Layout wraps children, so we might need to use the hook in a component inside Layout 
// OR just use it in Layout since Layout is part of value returned by generic Route.
// Actually, in Remix/React Router v7, Layout is a component.
function NavigationOverlay() {
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  return (
    <div
      className={`fixed inset-0 bg-black z-[9999] pointer-events-none transition-opacity duration-500 ease-in-out
        ${isNavigating ? "opacity-100" : "opacity-0"}`}
    />
  );
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // Simple script to blocking-load theme to prevent flash
  const themeScript = `
    (function() {
      const storedTheme = localStorage.getItem("theme");
      if (storedTheme === "light") {
        document.body.classList.add("light-mode");
      }
    })();
  `;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="flex flex-col min-h-screen relative font-sans antialiased text-slate-100 overflow-x-hidden transition-colors duration-500">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />

        {/* Animated Background Mesh */}
        <div className="fixed inset-0 z-0 bg-[#030712] pointer-events-none transition-colors duration-500 body-bg">
          {/* Light mode override in CSS */}
          <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-indigo-600/30 rounded-full blur-[100px] animate-aurora-1 opacity-40 mix-blend-screen" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-purple-600/20 rounded-full blur-[120px] animate-aurora-2 opacity-30 mix-blend-screen" />
        </div>

        {/* Content Layer */}
        <div className="relative z-10 flex-grow flex flex-col">
          {children}
        </div>

        {/* Global Navigation Overlay (Fade to Black) */}
        <NavigationOverlay />

        {/* Theme Toggle (Fixed) */}


        <footer className="relative z-20 py-8 mt-auto text-center border-t border-white/5 bg-black/40 backdrop-blur-md transition-colors duration-500 footer-glass">
          <div className="flex justify-center gap-6 text-[10px] uppercase font-bold tracking-[0.2em] text-white/40 mb-2">
            <a href="/privacy" className="hover:text-white transition-colors duration-300">Privacy Protocol</a>
            <span className="text-white/20">/</span>
            <a href="mailto:contact@geohunter.com" className="hover:text-white transition-colors duration-300">Support</a>
          </div>
          <div className="text-[9px] uppercase tracking-[0.3em] font-black text-white/20">
            Engineered by <span className="text-white/40">Lucas Cheung</span>
          </div>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}



export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
