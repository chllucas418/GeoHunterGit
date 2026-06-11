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
    href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;600;700&display=swap",
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
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <Meta />
        <Links />
      </head>
      <body className="flex flex-col min-h-screen relative font-body antialiased text-stone-100 overflow-x-hidden transition-colors duration-500">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />

        {/* Topographic Background */}
        <div className="fixed inset-0 z-0 bg-[#0e1a14] pointer-events-none transition-colors duration-500 body-bg">
          {/* Topographic contour lines */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="topo-lines" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
                <path d="M0 60 Q30 30 60 60 Q90 90 120 60" fill="none" stroke="#c9a84c" strokeWidth="0.5"/>
                <path d="M-20 80 Q20 40 60 80 Q100 120 140 80" fill="none" stroke="#c9a84c" strokeWidth="0.5"/>
                <path d="M0 20 Q40 0 60 20 Q80 40 120 20" fill="none" stroke="#c9a84c" strokeWidth="0.5"/>
                <circle cx="60" cy="60" r="35" fill="none" stroke="#c9a84c" strokeWidth="0.3"/>
                <circle cx="60" cy="60" r="50" fill="none" stroke="#c9a84c" strokeWidth="0.3"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#topo-lines)"/>
          </svg>
          {/* Warm ambient light pools */}
          <div className="absolute top-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-[#1a3a2f]/40 rounded-full blur-[150px] animate-aurora-1" />
          <div className="absolute bottom-[-15%] left-[-15%] w-[50vw] h-[50vw] bg-[#4a9b8c]/15 rounded-full blur-[120px] animate-aurora-2" />
        </div>

        {/* Content Layer */}
        <div className="relative z-10 flex-grow flex flex-col">
          {children}
          {/* --- Global System Footer (Sleek Centered Design) --- */}
          <footer className="relative z-20 py-12 mt-auto text-center border-t border-brass/10 bg-[#0e1a14]/40 backdrop-blur-md transition-colors duration-500 footer-glass">
            <div className="flex justify-center items-center gap-6 text-[10px] uppercase font-bold tracking-[0.3em] text-stone-400 mb-4">
              <a href="https://hkgeohunter.com/privacy" className="hover:text-brass transition-all duration-300">Privacy Policy</a>
              <span className="text-brass/20">/</span>
              <a href="/support" className="hover:text-brass transition-all duration-300">Support</a>
            </div>
            <div className="text-[9px] uppercase tracking-[0.5em] font-black text-stone-500 flex flex-col items-center gap-2">
              <span>Engineered by <span className="text-stone-300 tracking-[0.2em] font-black">Lucas Cheung</span></span>
              <span className="opacity-40 text-[7px] font-mono">Status: Optimized // All Rights Reserved</span>
            </div>
          </footer>
        </div>

        {/* Global Navigation Overlay (Fade to Black) */}
        <NavigationOverlay />

        {/* Theme Toggle (Fixed) */}


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
