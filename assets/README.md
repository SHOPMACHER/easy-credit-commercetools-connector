# Connector Web Components Integration Guide

This guide tells you how to install the web components of the connector. [Web Components](../docs/WebComponents.md) describes the components. For the architecture, see [Architecture Principles](../README.md#-architecture-principles).

## Install

- Deploy the connector. Then set all the credentials that the processor needs. See [Deploy and upgrade](../README.md#deploy-and-upgrade) and [connect.yaml](../connect.yaml).
- Load the enabler at runtime from the asset URL of the connector. See [Load the enabler](../docs/CommercetoolsFrontendIntegration.md#load-the-enabler). The URL always serves the enabler of the deployed connector release.
- For the TypeScript types, install the npm package as a development dependency: `npm i -D @shopmacher/easy-credit-commercetools-component@^1.1.0`. Use the package for the types. You should load the enabler code from the asset URL.

## Integrate the components

[Web Components](../docs/WebComponents.md) describes the label, widget, checkout and summary components and gives examples. For the full integration in commercetools Frontend, see [commercetools Frontend integration](../docs/CommercetoolsFrontendIntegration.md). The [demo file](./index.html) is also available.
