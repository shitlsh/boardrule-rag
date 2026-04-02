import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

import { GameDetail, type GameDetailModel } from "./game-detail";

export default async function GamePage({ params }: { params: { gameId: string } }) {
  const game = await prisma.game.findUnique({
    where: { id: params.gameId },
    include: { tasks: { orderBy: { createdAt: "desc" } } },
  });
  if (!game) {
    notFound();
  }
  const initialGame = JSON.parse(JSON.stringify(game)) as GameDetailModel;
  return <GameDetail initialGame={initialGame} />;
}
