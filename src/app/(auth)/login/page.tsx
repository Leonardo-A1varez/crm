import { LoginForm } from "@/components/auth/LoginForm";
import { loginAction } from "./_actions/login.action";

export default function LoginPage() {
  return <LoginForm onLogin={loginAction} />;
}
