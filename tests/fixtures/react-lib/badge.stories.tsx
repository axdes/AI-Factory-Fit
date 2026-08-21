import type { Meta, StoryObj } from "@storybook/react"
import { Badge } from "./badge"

// A modern story carries no JSX at all: the meta names the component and the
// args are the props. Scanning for `<Badge` finds nothing in the one file most
// worth reading.
const meta: Meta<typeof Badge> = { title: "UI/Badge", component: Badge }
export default meta
type Story = StoryObj<typeof Badge>

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Draft",
  },
}
