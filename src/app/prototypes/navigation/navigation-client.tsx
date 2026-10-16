"use client"

import dynamic from "next/dynamic";

const NavigationCanvas = dynamic(
    () => import("../../../components/prototypes/navigation-canvas"),
    {
        ssr: false,
        loading: () => <p>Loading the Navigation Prototype...</p>,
    },
);

export default function NavigationClient() {
    return <NavigationCanvas/>;
}

