/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { PageProps, Styles } from "@react-pdf/renderer";
import { Document, Font, Page, StyleSheet } from "@react-pdf/renderer";
import { Html } from "react-pdf-html";
// assets
import vazirmatnBold from "@/app/assets/fonts/vazirmatn/Vazirmatn-Bold.ttf?url";
import vazirmatnRegular from "@/app/assets/fonts/vazirmatn/Vazirmatn-Regular.ttf?url";
import vazirmatnSemibold from "@/app/assets/fonts/vazirmatn/Vazirmatn-SemiBold.ttf?url";
// plane imports
import { convertRemToPixel } from "@plane/utils";

const EDITOR_PDF_FONT_FAMILY_STYLES: Styles = {
  "*:not(.courier, .courier-bold)": { fontFamily: "Vazirmatn" },
  ".courier": { fontFamily: "Courier" },
  ".courier-bold": { fontFamily: "Courier-Bold" },
};

const EDITOR_PDF_TYPOGRAPHY_STYLES: Styles = {
  // page title
  "h1.page-title": {
    fontSize: convertRemToPixel(1.6),
    fontWeight: "bold",
    marginTop: 0,
    marginBottom: convertRemToPixel(2),
  },
  // headings
  "h1:not(.page-title)": {
    fontSize: convertRemToPixel(1.4),
    fontWeight: "semibold",
    marginTop: convertRemToPixel(2),
    marginBottom: convertRemToPixel(0.25),
  },
  h2: {
    fontSize: convertRemToPixel(1.2),
    fontWeight: "semibold",
    marginTop: convertRemToPixel(1.4),
    marginBottom: convertRemToPixel(0.0625),
  },
  h3: {
    fontSize: convertRemToPixel(1.1),
    fontWeight: "semibold",
    marginTop: convertRemToPixel(1),
    marginBottom: convertRemToPixel(0.0625),
  },
  h4: {
    fontSize: convertRemToPixel(1),
    fontWeight: "semibold",
    marginTop: convertRemToPixel(1),
    marginBottom: convertRemToPixel(0.0625),
  },
  h5: {
    fontSize: convertRemToPixel(0.9),
    fontWeight: "semibold",
    marginTop: convertRemToPixel(1),
    marginBottom: convertRemToPixel(0.0625),
  },
  h6: {
    fontSize: convertRemToPixel(0.8),
    fontWeight: "semibold",
    marginTop: convertRemToPixel(1),
    marginBottom: convertRemToPixel(0.0625),
  },
  // paragraph
  "p:not(table p)": {
    fontSize: convertRemToPixel(0.8),
  },
  "p:not(ol p, ul p)": {
    marginTop: convertRemToPixel(0.25),
    marginBottom: convertRemToPixel(0.0625),
  },
};

const EDITOR_PDF_LIST_STYLES: Styles = {
  "ul, ol": {
    fontSize: convertRemToPixel(0.8),
    marginHorizontal: -20,
  },
  "ol p, ul p": {
    marginVertical: 0,
  },
  "ol li, ul li": {
    marginTop: convertRemToPixel(0.45),
  },
  "ul ul, ul ol, ol ol, ol ul": {
    marginVertical: 0,
  },
  "ul[data-type='taskList']": {
    position: "relative",
  },
  "div.input-checkbox": {
    position: "absolute",
    top: convertRemToPixel(0.15),
    left: -convertRemToPixel(1.2),
    height: convertRemToPixel(0.75),
    width: convertRemToPixel(0.75),
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderRadius: convertRemToPixel(0.125),
  },
  "div.input-checkbox:not(.checked)": {
    backgroundColor: "#ffffff",
    borderColor: "#171717",
  },
  "div.input-checkbox.checked": {
    backgroundColor: "#3f76ff",
    borderColor: "#3f76ff",
  },
  "ul li[data-checked='true'] p": {
    color: "#a3a3a3",
  },
};

const EDITOR_PDF_CODE_STYLES: Styles = {
  // code block
  "[data-node-type='code-block']": {
    marginVertical: convertRemToPixel(0.5),
    padding: convertRemToPixel(1),
    borderRadius: convertRemToPixel(0.5),
    backgroundColor: "#f7f7f7",
    fontSize: convertRemToPixel(0.7),
  },
  // inline code block
  "[data-node-type='inline-code-block']": {
    margin: 0,
    paddingVertical: convertRemToPixel(0.25 / 4 + 0.25 / 8),
    paddingHorizontal: convertRemToPixel(0.375),
    border: "0.5px solid #e5e5e5",
    borderRadius: convertRemToPixel(0.25),
    backgroundColor: "#e8e8e8",
    color: "#f97316",
    fontSize: convertRemToPixel(0.7),
  },
};

const EDITOR_PDF_DOCUMENT_STYLESHEET = StyleSheet.create({
  ...EDITOR_PDF_FONT_FAMILY_STYLES,
  ...EDITOR_PDF_TYPOGRAPHY_STYLES,
  ...EDITOR_PDF_LIST_STYLES,
  ...EDITOR_PDF_CODE_STYLES,
  // quote block
  blockquote: {
    borderLeft: "3px solid gray",
    paddingLeft: convertRemToPixel(1),
    marginTop: convertRemToPixel(0.625),
    marginBottom: 0,
    marginHorizontal: 0,
  },
  img: {
    marginVertical: 0,
    borderRadius: convertRemToPixel(0.375),
  },
  // divider
  "div[data-type='horizontalRule']": {
    marginVertical: convertRemToPixel(1),
    height: 1,
    width: "100%",
    backgroundColor: "gray",
  },
  // mention block
  "[data-node-type='mention-block']": {
    margin: 0,
    color: "#3f76ff",
    backgroundColor: "#3f76ff33",
    paddingHorizontal: convertRemToPixel(0.375),
  },
  // table
  table: {
    marginTop: convertRemToPixel(0.5),
    marginBottom: convertRemToPixel(1),
    marginHorizontal: 0,
  },
  "table td": {
    padding: convertRemToPixel(0.625),
    border: "1px solid #e5e5e5",
  },
  "table p": {
    fontSize: convertRemToPixel(0.7),
  },
});

Font.register({
  family: "Vazirmatn",
  fonts: [
    { src: vazirmatnRegular, fontWeight: "normal" },
    { src: vazirmatnRegular, fontWeight: "normal", fontStyle: "italic" },
    { src: vazirmatnSemibold, fontWeight: "semibold" },
    { src: vazirmatnSemibold, fontWeight: "semibold", fontStyle: "italic" },
    { src: vazirmatnBold, fontWeight: "bold" },
    { src: vazirmatnBold, fontWeight: "bold", fontStyle: "italic" },
  ],
});

type Props = {
  content: string;
  pageFormat: PageProps["size"];
};

export function PDFDocument(props: Props) {
  const { content, pageFormat } = props;

  return (
    <Document language="fa">
      <Page
        size={pageFormat}
        style={{
          backgroundColor: "#ffffff",
          padding: 64,
          direction: "rtl",
          textAlign: "right",
        }}
      >
        <Html stylesheet={EDITOR_PDF_DOCUMENT_STYLESHEET}>{content}</Html>
      </Page>
    </Document>
  );
}
