import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.scss";

type BoundaryState = { error?: Error; componentStack?: string };

class AppErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = {};

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ error, componentStack: info.componentStack ?? "" });
    console.error("Erro ao renderizar a interface Helena", error, info.componentStack);
  }

  componentDidMount() {
    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  onWindowError = (event: ErrorEvent) => {
    this.setState({ error: event.error instanceof Error ? event.error : new Error(event.message) });
  };

  onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    this.setState({ error: reason instanceof Error ? reason : new Error(String(reason)) });
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const diagnostic = [
      `Tela: ${document.documentElement.dataset.screen ?? "desconhecida"}`,
      `${error.name}: ${error.message}`,
      error.stack ?? "",
      componentStack ?? "",
    ].filter(Boolean).join("\n");
    return <main className="runtime-error"><span className="brand-mark">h</span><p className="eyebrow">ERRO NA INTERFACE</p><h1>A Helena encontrou um erro nesta tela.</h1><p>Copie os detalhes abaixo e envie para corrigirmos a causa.</p><pre>{diagnostic}</pre><div><button className="secondary-button" onClick={() => void navigator.clipboard?.writeText(diagnostic)}>Copiar detalhes</button><button className="primary-button" onClick={() => window.location.reload()}>Reabrir aplicativo</button></div></main>;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
