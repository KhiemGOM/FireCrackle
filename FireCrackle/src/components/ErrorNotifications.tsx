import { Component, useEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { version } from "../../package.json";
import { dismissFailure, failureDetails, getFailures, reportError, subscribeFailures } from "../lib/appErrors";
import "./ErrorNotifications.css";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const diagnostic = new Error(error.message);
    diagnostic.stack = `${error.stack || error.message}\n${info.componentStack || ""}`;
    reportError("Display application", diagnostic);
  }
  render() {
    return this.state.failed ? <div className="fatal" role="alert">FireCrackle could not display this screen. <button onClick={() => window.location.reload()}>Reload app</button></div> : this.props.children;
  }
}

export function ErrorNotifications() {
  const failures = useSyncExternalStore(subscribeFailures, getFailures, getFailures);
  const item = failures[0];
  const dialog = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setCopyStatus("");
    const element = dialog.current;
    if (!item || !element) return;
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [item?.id]);
  if (!item) return null;
  const diagnostics = `FireCrackle ${version}\n${navigator.userAgent}\n${failureDetails(item)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(diagnostics); setCopyStatus("Copied"); }
    catch { setCopyStatus("Copy unavailable. Select the details below to copy them."); }
  };
  return createPortal(<dialog ref={dialog} className="failure-dialog" role="alertdialog" aria-modal="true" aria-labelledby="failure-title" aria-describedby="failure-message" onCancel={event => { event.preventDefault(); dismissFailure(item.id); }} onKeyDown={event => event.stopPropagation()}>
    <header><h2 id="failure-title">Something went wrong</h2><button aria-label="Dismiss error" onClick={() => dismissFailure(item.id)}>×</button></header>
    <strong>{item.context}</strong>
    <p id="failure-message">{item.message}</p>
    {item.count > 1 && <p className="failure-muted">Repeated {item.count} times.</p>}
    <details><summary>Error details</summary><textarea readOnly aria-label="Error details" value={diagnostics} onFocus={event => event.currentTarget.select()} /></details>
    <footer><span role="status">{copyStatus || (failures.length > 1 ? `${failures.length} errors to review` : "")}</span><button onClick={() => void copy()}>Copy error</button><button autoFocus onClick={() => dismissFailure(item.id)}>{failures.length > 1 ? "Next error" : "Dismiss"}</button></footer>
  </dialog>, document.body);
}
