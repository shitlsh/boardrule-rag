export {}

declare module 'vue' {
  type Hooks = App.AppInstance & Page.PageInstance
  interface ComponentCustomOptions extends Hooks {}

  // Declare towxml as a known global component so vue-tsc does not fall back
  // to HTMLElement attribute types when encountering <towxml> in templates.
  interface GlobalComponents {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Towxml: import('vue').DefineComponent<{
      nodes?: any
      type?: string
      customAttrs?: Record<string, unknown>
    }>
  }
}
