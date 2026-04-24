package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func main() {
	var name string
	root := &cobra.Command{
		Use:   "hello [name]",
		Short: "Say hello to someone",
		Run: func(cmd *cobra.Command, args []string) {
			who := name
			if who == "" && len(args) > 0 {
				who = args[0]
			}
			if who == "" {
				who = "world"
			}
			fmt.Println("Hello, " + who + "!")
		},
	}
	root.Flags().StringVarP(&name, "name", "n", "", "name to greet")
	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}
