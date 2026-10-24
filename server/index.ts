/**
 * DocuLoom local server.
 *
 * Binds to loopback only: this process is the application's backend, not a
 * service for anything else on the network to reach.
 */
import express from 'express'
import { api } from './routes/api.js'
import { getDb } from './db/index.js'

const PORT = Number(process.env.DOCULOOM_PORT ?? 5274)
const HOST = '127.0.0.1'

const app = express()

// Imported PDFs arrive as a raw body; everything else is small JSON.
app.use('/api/papers', express.raw({ type: 'application/pdf', limit: '64mb' }))
app.use(express.json({ limit: '1mb' }))
app.use('/api', api)

getDb()

app.listen(PORT, HOST, () => {
  console.log(`DocuLoom server on http://${HOST}:${PORT}`)
})
