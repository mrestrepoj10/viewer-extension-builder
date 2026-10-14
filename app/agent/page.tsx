import { ViewerAgent, ViewerAgentSetupNotice } from '@/components/viewer-agent'
import { AGENT_EFFORT, AGENT_MODEL, AGENT_SPEED } from '@/lib/agent-model'

export default function ViewerAgentPage() {
  const urn = process.env.APS_MODEL_URN
  if (!urn) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <ViewerAgentSetupNotice />
      </main>
    )
  }
  return <ViewerAgent urn={urn} model={AGENT_MODEL} effort={AGENT_EFFORT} speed={AGENT_SPEED} />
}
