import type JSZip from 'jszip';

const DRAWINGML_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATIONML_NAMESPACE = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const ELEMENT_NODE = 1;
const PRESENTATION_XML_PATH = 'ppt/presentation.xml';
const SLIDE_XML_PATH = /^ppt\/slides\/slide\d+\.xml$/;

type XmlParser = Pick<DOMParser, 'parseFromString'>;
type XmlSerializer = Pick<XMLSerializer, 'serializeToString'>;

function getElementChildren(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (child): child is Element => child.nodeType === ELEMENT_NODE,
  );
}

function getDirectChild(
  parent: Element,
  namespace: string,
  localName: string,
): Element | undefined {
  return getElementChildren(parent).find(
    child => child.namespaceURI === namespace && child.localName === localName,
  );
}

function mergeRunProperties(document: Document, defaults: Element, explicit?: Element): Element {
  const merged = document.createElementNS(DRAWINGML_NAMESPACE, 'a:rPr');

  for (const attribute of Array.from(defaults.attributes)) {
    merged.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  for (const child of Array.from(defaults.childNodes)) {
    merged.appendChild(child.cloneNode(true));
  }

  if (!explicit) return merged;

  for (const attribute of Array.from(explicit.attributes)) {
    merged.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  for (const child of getElementChildren(explicit)) {
    const inheritedChild = getDirectChild(merged, child.namespaceURI ?? '', child.localName);
    if (inheritedChild) {
      merged.replaceChild(child.cloneNode(true), inheritedChild);
    } else {
      merged.appendChild(child.cloneNode(true));
    }
  }

  return merged;
}

export function materializeParagraphDefaultRunProperties(
  xml: string,
  parser: XmlParser = new DOMParser(),
  serializer: XmlSerializer = new XMLSerializer(),
): { xml: string; changed: boolean } {
  const document = parser.parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    return { xml, changed: false };
  }

  let changed = false;
  const paragraphs = Array.from(document.getElementsByTagNameNS(DRAWINGML_NAMESPACE, 'p'));

  for (const paragraph of paragraphs) {
    const paragraphProperties = getDirectChild(paragraph, DRAWINGML_NAMESPACE, 'pPr');
    const defaults = paragraphProperties
      ? getDirectChild(paragraphProperties, DRAWINGML_NAMESPACE, 'defRPr')
      : undefined;
    if (!defaults) continue;

    const runs = getElementChildren(paragraph).filter(
      child => child.namespaceURI === DRAWINGML_NAMESPACE && child.localName === 'r',
    );
    for (const run of runs) {
      const explicit = getDirectChild(run, DRAWINGML_NAMESPACE, 'rPr');
      const merged = mergeRunProperties(document, defaults, explicit);
      if (explicit) {
        run.replaceChild(merged, explicit);
      } else {
        run.insertBefore(merged, run.firstChild);
      }
      changed = true;
    }
  }

  return {
    xml: changed ? serializer.serializeToString(document) : xml,
    changed,
  };
}

export function ensurePresentationDefaultTextStyle(
  xml: string,
  parser: XmlParser = new DOMParser(),
  serializer: XmlSerializer = new XMLSerializer(),
): { xml: string; changed: boolean } {
  const document = parser.parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    return { xml, changed: false };
  }

  const presentation = document.documentElement;
  if (
    presentation.namespaceURI !== PRESENTATIONML_NAMESPACE ||
    presentation.localName !== 'presentation'
  ) {
    return { xml, changed: false };
  }

  if (getDirectChild(presentation, PRESENTATIONML_NAMESPACE, 'defaultTextStyle')) {
    return { xml, changed: false };
  }

  const defaultTextStyle = document.createElementNS(PRESENTATIONML_NAMESPACE, 'p:defaultTextStyle');
  const extensionList = getDirectChild(presentation, PRESENTATIONML_NAMESPACE, 'extLst');
  presentation.insertBefore(defaultTextStyle, extensionList ?? null);

  return { xml: serializer.serializeToString(document), changed: true };
}

async function removeMissingContentTypeOverrides(zip: JSZip): Promise<void> {
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (!contentTypesFile) return;

  let contentTypes = await contentTypesFile.async('string');
  const overridePattern = /<Override[^>]+PartName="([^"]+)"[^>]*\/>/g;
  const missingOverrides: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = overridePattern.exec(contentTypes)) !== null) {
    const partName = match[1];
    const zipPath = partName.startsWith('/') ? partName.slice(1) : partName;
    if (!zip.file(zipPath)) missingOverrides.push(match[0]);
  }

  for (const override of missingOverrides) {
    contentTypes = contentTypes.replace(override, '');
  }
  zip.file('[Content_Types].xml', contentTypes);
}

export async function normalizePptxData(data: ArrayBuffer): Promise<ArrayBuffer> {
  const JSZipConstructor = (await import('jszip')).default;
  const zip = await JSZipConstructor.loadAsync(data);

  await removeMissingContentTypeOverrides(zip);

  const presentationFile = zip.file(PRESENTATION_XML_PATH);
  if (presentationFile) {
    const source = await presentationFile.async('string');
    const normalized = ensurePresentationDefaultTextStyle(source);
    if (normalized.changed) zip.file(PRESENTATION_XML_PATH, normalized.xml);
  }

  const slideFiles = Object.values(zip.files).filter(
    file => !file.dir && SLIDE_XML_PATH.test(file.name),
  );
  await Promise.all(
    slideFiles.map(async file => {
      const source = await file.async('string');
      const normalized = materializeParagraphDefaultRunProperties(source);
      if (normalized.changed) zip.file(file.name, normalized.xml);
    }),
  );

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
