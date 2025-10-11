import { ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const getJwt = () => localStorage.getItem("jwt") || localStorage.getItem("token");

export default function RequireAuth({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const token = getJwt();
    if (!token) {
      nav("/login", { replace: true, state: { from: loc.pathname || "/" } });
    }
    // IMPORTANT: do NOT navigate away if token exists (prevents flicker)
  }, [nav, loc]);

  return <>{children}</>;
}
