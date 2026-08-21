import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HomePage from '../src/pages/HomePage.vue'

describe('HomePage', () => {
  it('renders', () => {
    expect(mount(HomePage).exists()).toBe(true)
  })
})
