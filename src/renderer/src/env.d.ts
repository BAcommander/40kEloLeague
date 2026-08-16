/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the league API worker; unset in dev = in-memory local backend. */
  readonly VITE_WORKER_URL?: string
}
