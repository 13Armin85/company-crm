/**
 * Public entry point of the CRM data layer. Pages and components import from "crm/api" only;
 * the modules behind it are split by domain so each one stays small and focused.
 */
export * from "./client";
export * from "./mappers";
export * from "./user";
export * from "./workspace";
export * from "./projects";
export * from "./issues";
export * from "./notifications";
export * from "./organization";
export * from "./routing";
export * from "./work-calendar";
export { useAccess as useWorkspaceAccess } from "../access/api";
