import type { Meta, StoryObj } from '@storybook/react'
import AppShell from './AppShell'

const meta = {
  title: 'Chrome/AppShell',
  component: AppShell,
  tags: ['autodocs'],
} satisfies Meta<typeof AppShell>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = { args: { title: 'Home' } }
