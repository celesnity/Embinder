import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Bind IPv4 loopback explicitly — Vite's bare "localhost" default resolves to the
  // IPv6-only ::1 on this host, which refuses http://127.0.0.1 connections.
  server: { host: '127.0.0.1' },
})
