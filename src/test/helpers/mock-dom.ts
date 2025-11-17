export class MockHTMLElement {
  tagName: string;
  textContent: string | null = null;
  parentElement: MockHTMLElement | null = null;
  ownerDocument: Document | null = null;
  private _id = '';
  attributes = new Map<string, string>();
  children: MockHTMLElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get id(): string {
    return this._id;
  }

  set id(value: string) {
    this._id = value;
    if (value && this.ownerDocument) {
      (this.ownerDocument as unknown as MockDocument).register(this);
    }
  }

  appendChild(child: MockHTMLElement) {
    child.parentElement = this;
    this.children.push(child);
    if (this.ownerDocument) {
      (this.ownerDocument as unknown as MockDocument).register(child);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  closest(selector: string) {
    if (selector === 'label') {
      let node: MockHTMLElement | null = this.parentElement;
      while (node) {
        if (node.tagName === 'LABEL') return node;
        node = node.parentElement;
      }
    }
    return null;
  }
}

export class MockHTMLInputElement extends MockHTMLElement {}
export class MockHTMLTextAreaElement extends MockHTMLElement {}
export class MockHTMLSelectElement extends MockHTMLElement {}
export class MockHTMLLabelElement extends MockHTMLElement {
  constructor() {
    super('label');
  }
}

export class MockDocument {
  private elements = new Map<string, MockHTMLElement>();
  body: MockHTMLElement;
  implementation = {
    createHTMLDocument: () => new MockDocument(),
  };

  constructor() {
    this.body = new MockHTMLElement('body');
    this.body.ownerDocument = this as unknown as Document;
  }

  register(element: MockHTMLElement) {
    element.ownerDocument = this as unknown as Document;
    if (element.id) {
      this.elements.set(element.id, element);
    }
  }

  getElementById(id: string): MockHTMLElement | null {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName: string): MockHTMLElement {
    const element = new MockHTMLElement(tagName);
    this.register(element);
    return element;
  }
}

export function createMockDocument(): MockDocument {
  return new MockDocument();
}

export function registerGlobalDomMocks(): void {
  const globalAny = globalThis as any;
  globalAny.HTMLElement = MockHTMLElement;
  globalAny.Element = MockHTMLElement;
  globalAny.HTMLInputElement = MockHTMLInputElement;
  globalAny.HTMLTextAreaElement = MockHTMLTextAreaElement;
  globalAny.HTMLSelectElement = MockHTMLSelectElement;
  globalAny.HTMLLabelElement = MockHTMLLabelElement;
}
