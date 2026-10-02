/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { fileURLToPath } from "node:url";
import { Document, Font, Page, pdf, Text } from "@react-pdf/renderer";
import { createKeyGenerator, renderNode } from "./node-renderers";
import { pdfStyles } from "./styles";
import type { PDFExportOptions, TipTapDocument } from "./types";

// tsdown copies these files next to the built entry point as well.
const regularFont = fileURLToPath(new URL("./fonts/Vazirmatn-Regular.ttf", import.meta.url));
const semiboldFont = fileURLToPath(new URL("./fonts/Vazirmatn-SemiBold.ttf", import.meta.url));
const boldFont = fileURLToPath(new URL("./fonts/Vazirmatn-Bold.ttf", import.meta.url));

Font.register({
  family: "Vazirmatn",
  fonts: [
    {
      src: regularFont,
      fontWeight: 400,
    },
    {
      src: regularFont,
      fontWeight: 400,
      fontStyle: "italic",
    },
    {
      src: semiboldFont,
      fontWeight: 600,
    },
    {
      src: semiboldFont,
      fontWeight: 600,
      fontStyle: "italic",
    },
    {
      src: boldFont,
      fontWeight: 700,
    },
    {
      src: boldFont,
      fontWeight: 700,
      fontStyle: "italic",
    },
  ],
});

export const createPdfDocument = (doc: TipTapDocument, options: PDFExportOptions = {}) => {
  const { title, author, subject, pageSize = "A4", pageOrientation = "portrait", metadata, noAssets } = options;

  // Merge noAssets into metadata for use in node renderers
  const mergedMetadata = { ...metadata, noAssets };

  const content = doc.content || [];
  const getKey = createKeyGenerator();
  const renderedContent = content.map((node, index) => renderNode(node, "doc", index, mergedMetadata, getKey));

  return (
    <Document title={title} author={author} subject={subject} language="fa">
      <Page size={pageSize} orientation={pageOrientation} style={pdfStyles.page}>
        {title && <Text style={pdfStyles.title}>{title}</Text>}
        {renderedContent}
      </Page>
    </Document>
  );
};

export const renderPlaneDocToPdfBuffer = async (
  doc: TipTapDocument,
  options: PDFExportOptions = {}
): Promise<Buffer> => {
  const pdfDocument = createPdfDocument(doc, options);
  const pdfInstance = pdf(pdfDocument);
  const blob = await pdfInstance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const renderPlaneDocToPdfBlob = async (doc: TipTapDocument, options: PDFExportOptions = {}): Promise<Blob> => {
  const pdfDocument = createPdfDocument(doc, options);
  const pdfInstance = pdf(pdfDocument);
  return await pdfInstance.toBlob();
};
